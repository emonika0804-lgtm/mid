import { requestApi, TestItem } from './testApp';
import db from '../server/src/db';
import { getCapturedOutbox, clearCapturedOutbox } from '../server/src/emailService';

export async function runAuthSuite(): Promise<TestItem[]> {
  const tests: TestItem[] = [];
  function record(id: string, name: string, condition: boolean, details?: string) {
    tests.push({ id, name, pass: condition, details });
    console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${id}: ${name}${details ? ` -> ${details}` : ''}`);
  }

  console.log('\n--- SUITE 1: Comprehensive Authentication & RBAC Tests ---');
  clearCapturedOutbox();

  const ts = Date.now();
  const testUserEmail = `auth.test.${ts}@pilship.com`;
  const testPassword = 'Password123!';

  // 1. Weak password rejected on registration
  const weakPwdRes = await requestApi('POST', '/api/auth/register', {
    full_name: 'Weak Pass User',
    email: `weak.${ts}@pilship.com`,
    password: 'weak',
  });
  record('AUTH-1.1', 'Weak password (<8 chars) rejected on registration', weakPwdRes.status === 400);

  // 2. Successful registration creates unverified user without returning plaintext OTP
  const regRes = await requestApi('POST', '/api/auth/register', {
    full_name: 'Auth Test User',
    email: testUserEmail,
    password: testPassword,
  });
  const noOtpLeaked = !regRes.body.simulated_otp && !regRes.body.otp;
  record(
    'AUTH-1.2',
    'Registration creates user and dispatches OTP without leaking code in API body',
    regRes.status === 201 && noOtpLeaked && regRes.body.resend_cooldown_seconds === 60
  );

  // 3. User is locked to 'agency' role by default (privilege escalation blocked)
  const userInDb = (await db.prepare('SELECT role, is_verified FROM users WHERE email = ?').get(testUserEmail)) as any;
  record('AUTH-1.3', 'Public registration strictly assigns agency role (least privilege)', userInDb?.role === 'agency' && userInDb?.is_verified === 0);

  // 4. Unverified user blocked from logging in
  const unverifiedLogin = await requestApi('POST', '/api/auth/login', {
    email: testUserEmail,
    password: testPassword,
  });
  record('AUTH-1.4', 'Unverified account login blocked with 403 and needs_otp flag', unverifiedLogin.status === 403 && unverifiedLogin.body.needs_otp === true);

  // 5. OTP stored as salted SHA-256 hash in user_otps
  const otpInDb = (await db.prepare('SELECT otp_hash FROM user_otps WHERE email = ?').get(testUserEmail)) as any;
  record('AUTH-1.5', 'OTP is cryptographically hashed with SHA-256 in user_otps (64 hex characters)', Boolean(otpInDb && otpInDb.otp_hash.length === 64));

  // 6. Extract OTP from captured outbox and verify
  const outbox = getCapturedOutbox();
  const otpEmail = outbox.find((m) => m.to === testUserEmail && m.templateType === 'OTP');
  const otpCode = otpEmail?.html.match(/<div class="otp-box">(\d{6})<\/div>/)?.[1];
  record('AUTH-1.6', 'Captured test outbox received branded OTP email with valid 6-digit code', Boolean(otpEmail && otpCode && otpCode.length === 6));

  // 7. Successful verification returns JWT token and marks verified
  const verifyRes = await requestApi('POST', '/api/auth/verify-otp', {
    email: testUserEmail,
    otp: otpCode,
  });
  const userJwt = verifyRes.body.token;
  record('AUTH-1.7', 'Valid OTP verifies user account and issues JWT session token', verifyRes.status === 200 && Boolean(userJwt));

  // 8. Replay of used OTP is rejected
  const replayRes = await requestApi('POST', '/api/auth/verify-otp', {
    email: testUserEmail,
    otp: otpCode,
  });
  record('AUTH-1.8', 'Used OTP rejected on replay attempt (single-use enforced)', replayRes.status === 400);

  // 9. Verified user can now log in normally
  const loginRes = await requestApi('POST', '/api/auth/login', {
    email: testUserEmail,
    password: testPassword,
  });
  record('AUTH-1.9', 'Verified user logs in successfully with correct credentials', loginRes.status === 200 && Boolean(loginRes.body.token));

  // 10. Invalid password rejected
  const badLogin = await requestApi('POST', '/api/auth/login', {
    email: testUserEmail,
    password: 'WrongPassword!',
  });
  record('AUTH-1.10', 'Incorrect password rejected with 401 Unauthorized', badLogin.status === 401);

  // 11. Role permissions: Admin can access /api/users
  const adminLogin = await requestApi('POST', '/api/auth/login', { email: 'admin@pilship.com', password: 'Password123!' });
  const adminToken = adminLogin.body.token;
  const usersListRes = await requestApi('GET', '/api/users', null, adminToken);
  record('AUTH-1.11', 'Admin role can access user administration API (200 OK)', usersListRes.status === 200 && Array.isArray(usersListRes.body));

  // 12. Role permissions: Agency user CANNOT access /api/users (403 Forbidden)
  const agencyDeniedUsers = await requestApi('GET', '/api/users', null, userJwt);
  record('AUTH-1.12', 'Agency role denied access to user administration (403 Forbidden)', agencyDeniedUsers.status === 403);

  // 13. Role permissions: Agency user CANNOT access dashboard metrics (403 Forbidden)
  const agencyDeniedDashboard = await requestApi('GET', '/api/dashboard/metrics', null, userJwt);
  record('AUTH-1.13', 'Agency role denied access to dashboard metrics (403 Forbidden)', agencyDeniedDashboard.status === 403);

  // 14. MID user can access dashboard metrics
  const midLogin = await requestApi('POST', '/api/auth/login', { email: 'mid@pilship.com', password: 'Password123!' });
  const midToken = midLogin.body.token;
  const midDashboardRes = await requestApi('GET', '/api/dashboard/metrics', null, midToken);
  record('AUTH-1.14', 'MID role authorized to access dashboard metrics (200 OK)', midDashboardRes.status === 200 && Boolean(midDashboardRes.body.claims));

  // 15. Unauthenticated request to protected endpoint rejected with 401
  const unauthRes = await requestApi('GET', '/api/claims');
  record('AUTH-1.15', 'Unauthenticated request to protected API rejected with 401 Unauthorized', unauthRes.status === 401);

  // 16. Tampered JWT signature rejected with 401
  const tamperedToken = `${userJwt.substring(0, userJwt.length - 8)}fakefake`;
  const tamperedRes = await requestApi('GET', '/api/auth/me', null, tamperedToken);
  record('AUTH-1.16', 'Tampered JWT token rejected with 401 Unauthorized', tamperedRes.status === 401);

  // 17. Password reset anti-enumeration
  const forgotNonExistent = await requestApi('POST', '/api/auth/forgot-password', { email: 'nobody@nowhere.com' });
  const forgotExistent = await requestApi('POST', '/api/auth/forgot-password', { email: testUserEmail });
  record(
    'AUTH-1.17',
    'Forgot password prevents account enumeration with identical responses and zero hints',
    forgotNonExistent.body.message === forgotExistent.body.message && !forgotExistent.body.reset_token_hint
  );

  // 18. Password reset token stored hashed & delivered via captured outbox
  const outboxAfterForgot = getCapturedOutbox();
  const resetEmail = outboxAfterForgot.find((m) => m.to === testUserEmail && m.templateType === 'PASSWORD_RESET');
  const rawResetToken = resetEmail?.html.match(/token=([a-f0-9]{64})/)?.[1];
  record('AUTH-1.18', 'Password reset email formatted with 32-byte (64 hex char) random token', Boolean(resetEmail && rawResetToken && rawResetToken.length === 64));

  // 19. Password reset completes with new strong password
  const newPass = 'BrandNewP@ss2026!';
  const resetRes = await requestApi('POST', '/api/auth/reset-password', {
    token: rawResetToken,
    new_password: newPass,
  });
  record('AUTH-1.19', 'Password reset succeeds with valid token and updates credentials', resetRes.status === 200);

  // 20. Session invalidation: previous JWT token is now invalid due to token_version increment
  const oldJwtRes = await requestApi('GET', '/api/auth/me', null, userJwt);
  record('AUTH-1.20', 'Pre-existing JWT sessions invalidated immediately after password change', oldJwtRes.status === 401);

  // 21. Security Regression: Arbitrary email cannot obtain JWT session token via Google endpoint
  const arbitraryGoogleLogin = await requestApi('POST', '/api/auth/google', {
    email: 'attacker.unverified@external.com',
    full_name: 'Attacker Impersonator',
  });
  record(
    'AUTH-1.21',
    'Arbitrary email cannot obtain JWT session token via Google endpoint (HTTP 501 rejection)',
    arbitraryGoogleLogin.status === 501 &&
    !arbitraryGoogleLogin.body.token &&
    arbitraryGoogleLogin.body.code === 'GOOGLE_OAUTH_DISABLED'
  );

  // 22. Security Regression: Privileged admin account cannot be hijacked via Google endpoint
  const adminHijackAttempt = await requestApi('POST', '/api/auth/google', {
    email: 'admin@pilship.com',
    full_name: 'Admin Hijacker',
  });
  record(
    'AUTH-1.22',
    'Privileged admin account cannot be hijacked via Google endpoint (HTTP 501, zero tokens)',
    adminHijackAttempt.status === 501 &&
    !adminHijackAttempt.body.token &&
    adminHijackAttempt.body.code === 'GOOGLE_OAUTH_DISABLED'
  );

  // 23. Security Regression: Blocked Google login attempt is audited in auth_audit_logs
  const auditEvent = (await db.prepare(`
    SELECT event_type, email, details FROM auth_audit_logs
    WHERE email = 'admin@pilship.com' AND event_type = 'LOGIN_FAILED'
    ORDER BY created_at DESC LIMIT 1
  `).get()) as any;
  record(
    'AUTH-1.23',
    'Blocked Google login attempt is audited in auth_audit_logs with LOGIN_FAILED event',
    Boolean(auditEvent && auditEvent.event_type === 'LOGIN_FAILED')
  );

  // 24. Security Regression: Admin updates user role and increments token_version
  const targetUserBefore = (await db.prepare('SELECT id, role, token_version FROM users WHERE email = ?').get(testUserEmail)) as any;
  const loginBeforeRoleChange = await requestApi('POST', '/api/auth/login', {
    email: testUserEmail,
    password: newPass,
  });
  const tokenBeforeRoleChange = loginBeforeRoleChange.body.token;

  const roleUpdateRes = await requestApi(
    'PUT',
    `/api/users/${targetUserBefore.id}/role`,
    { role: 'mid' },
    adminToken
  );
  const targetUserAfter = (await db.prepare('SELECT id, role, token_version FROM users WHERE id = ?').get(targetUserBefore.id)) as any;
  record(
    'AUTH-1.24',
    'Admin updates user role and increments user token_version in database',
    roleUpdateRes.status === 200 &&
    roleUpdateRes.body.user.role === 'mid' &&
    targetUserAfter.role === 'mid' &&
    targetUserAfter.token_version > (targetUserBefore.token_version || 1)
  );

  // 25. Security Regression: Pre-existing JWT sessions for updated user rejected immediately
  const oldTokenMeRes = await requestApi('GET', '/api/auth/me', null, tokenBeforeRoleChange);
  const oldTokenClaimsRes = await requestApi('GET', '/api/claims', null, tokenBeforeRoleChange);
  record(
    'AUTH-1.25',
    'Pre-existing JWT sessions with old role are rejected immediately (401 Unauthorized)',
    oldTokenMeRes.status === 401 && oldTokenClaimsRes.status === 401
  );

  // 26. Security Regression: Unrelated users sessions remain active and unrevoked
  const adminSessionRes = await requestApi('GET', '/api/users', null, adminToken);
  record(
    'AUTH-1.26',
    'Unrelated user sessions (e.g. admin session) remain active and valid (200 OK)',
    adminSessionRes.status === 200 && Array.isArray(adminSessionRes.body)
  );

  // 27. Security Regression: User logs in again, receiving new token with updated role and permissions
  const reLoginRes = await requestApi('POST', '/api/auth/login', {
    email: testUserEmail,
    password: newPass,
  });
  const newToken = reLoginRes.body.token;
  const meAfterLoginRes = await requestApi('GET', '/api/auth/me', null, newToken);
  const midDashboardRes2 = await requestApi('GET', '/api/dashboard/metrics', null, newToken);
  record(
    'AUTH-1.27',
    'User logs in again and receives valid token with updated role and elevated permissions (200 OK)',
    reLoginRes.status === 200 &&
    Boolean(newToken) &&
    meAfterLoginRes.status === 200 &&
    meAfterLoginRes.body.user.role === 'mid' &&
    midDashboardRes2.status === 200 &&
    Boolean(midDashboardRes2.body.claims)
  );

  return tests;
}
