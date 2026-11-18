import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import db from './db';
import { sendOtpEmail, sendPasswordResetEmail } from './emailService';
import { logAuthEvent } from './authAuditService';

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret === 'pil-cargo-claims-secret-key-2026') {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('[SECURITY FATAL] A strong, dedicated JWT_SECRET must be configured in environment variables for production.');
    }
  }
  return secret || 'pil-cargo-claims-secret-key-2026';
}

export const JWT_SECRET = getJwtSecret();
const OTP_SALT = process.env.OTP_SALT || 'pil-cargo-claims-otp-salt-2026';

export interface AuthUser {
  id: string;
  email: string;
  full_name: string;
  role: 'agency' | 'mid' | 'mid_gcc' | 'admin';
  is_verified?: number;
  token_version?: number;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}

export function hashOtp(otp: string): string {
  return crypto.createHash('sha256').update(otp + OTP_SALT).digest('hex');
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function validatePasswordStrength(password: string): { valid: boolean; error?: string } {
  if (typeof password !== 'string' || password.length < 8) {
    return { valid: false, error: 'Password must be at least 8 characters in length.' };
  }
  const hasLetter = /[a-zA-Z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  if (!hasLetter || !hasNumber) {
    return { valid: false, error: 'Password must contain at least one letter and one number.' };
  }
  return { valid: true };
}

export function generateToken(user: AuthUser): string {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      role: user.role,
      token_version: user.token_version || 1,
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

export async function authenticate(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as AuthUser;
    
    // Check if token_version is still valid against PostgreSQL user record
    const userRec = (await db.prepare('SELECT token_version FROM users WHERE id = ?').get(decoded.id)) as any;
    if (userRec) {
      const dbTokenVersion = userRec.token_version || 1;
      const tokenVersion = decoded.token_version || 1;
      if (dbTokenVersion !== tokenVersion) {
        return res.status(401).json({ error: 'Session invalidated due to password change or role update. Please log in again.' });
      }
    }

    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function requireRole(allowedRoles: string[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Access denied: insufficient permissions' });
    }
    next();
  };
}

// -------------------------------------------------------------
// Auth Controllers
// -------------------------------------------------------------

export async function login(req: Request, res: Response) {
  const { email, password } = req.body;
  const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || null;
  const userAgent = req.headers['user-agent'] || null;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const cleanEmail = email.trim().toLowerCase();
  const user = (await db.prepare('SELECT * FROM users WHERE email = ?').get(cleanEmail)) as any;
  if (!user) {
    await logAuthEvent({
      event_type: 'LOGIN_FAILED',
      email: cleanEmail,
      ip_address: ip,
      user_agent: userAgent,
      details: { reason: 'User not found' },
    });
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const match = bcrypt.compareSync(password, user.password_hash);
  if (!match) {
    await logAuthEvent({
      event_type: 'LOGIN_FAILED',
      user_id: user.id,
      email: cleanEmail,
      ip_address: ip,
      user_agent: userAgent,
      details: { reason: 'Invalid password' },
    });
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  if (!user.is_verified) {
    return res.status(403).json({
      error: 'Account not verified. Please verify your OTP code.',
      needs_otp: true,
      email: user.email,
    });
  }

  const token = generateToken({
    id: user.id,
    email: user.email,
    full_name: user.full_name,
    role: user.role,
    token_version: user.token_version || 1,
  });

  await logAuthEvent({
    event_type: 'LOGIN_SUCCESS',
    user_id: user.id,
    email: cleanEmail,
    ip_address: ip,
    user_agent: userAgent,
  });

  return res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      role: user.role,
    },
  });
}

export async function register(req: Request, res: Response) {
  const { full_name, email, password } = req.body;
  const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || null;
  const userAgent = req.headers['user-agent'] || null;

  if (!full_name || !email || !password) {
    return res.status(400).json({ error: 'Full name, email, and password are required' });
  }

  const cleanEmail = email.trim().toLowerCase();
  const pwdValidation = validatePasswordStrength(password);
  if (!pwdValidation.valid) {
    return res.status(400).json({ error: pwdValidation.error });
  }

  // Least privilege: public registration is locked strictly to 'agency'
  const assignedRole = 'agency';

  const existing = await db.prepare('SELECT id FROM users WHERE email = ?').get(cleanEmail);
  if (existing) {
    return res.status(400).json({ error: 'An account with this email already exists' });
  }

  const salt = bcrypt.genSaltSync(10);
  const password_hash = bcrypt.hashSync(password, salt);
  const now = new Date().toISOString();
  const userId = `usr-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;

  // 1. Generate unpredictable 6-digit cryptographic OTP
  const rawOtp = crypto.randomInt(100000, 1000000).toString();
  const otpHash = hashOtp(rawOtp);
  const otpId = `otp-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 minutes
  const resendAvailableAt = new Date(Date.now() + 60 * 1000).toISOString(); // 60s cooldown

  // 2. Insert user with is_verified = 0
  await db.prepare(`
    INSERT INTO users (id, created_date, updated_date, full_name, email, password_hash, role, is_verified, token_version)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1)
  `).run(userId, now, now, full_name.trim(), cleanEmail, password_hash, assignedRole);

  // 3. Store hashed OTP in user_otps
  await db.prepare(`
    INSERT INTO user_otps (
      id, user_id, email, otp_hash, created_at, expires_at, resend_available_at, attempts, max_attempts, is_used
    ) VALUES (?, ?, ?, ?, NOW(), ?, ?, 0, 5, FALSE)
  `).run(otpId, userId, cleanEmail, otpHash, expiresAt, resendAvailableAt);

  // 4. Dispatch OTP email via email service
  const emailResult = await sendOtpEmail({
    to: cleanEmail,
    fullName: full_name.trim(),
    otp: rawOtp,
    expiresInMinutes: 10,
  });

  // 5. Audit log (sanitized — no plaintext OTP)
  await logAuthEvent({
    event_type: 'USER_REGISTERED',
    user_id: userId,
    email: cleanEmail,
    ip_address: ip,
    user_agent: userAgent,
    details: { assignedRole },
  });

  await logAuthEvent({
    event_type: 'OTP_GENERATED',
    user_id: userId,
    email: cleanEmail,
    ip_address: ip,
    user_agent: userAgent,
    details: { otpId, expiresInMinutes: 10, emailDeliveryStatus: emailResult.status },
  });

  if (!emailResult.success) {
    console.error(`[Auth] OTP email delivery failed for ${cleanEmail}: ${emailResult.status} — ${emailResult.error || 'no error detail'}`);
  }

  return res.status(201).json({
    message: emailResult.success
      ? 'Registration successful. A 6-digit verification code has been dispatched to your email address.'
      : 'Registration successful. However, we were unable to deliver the verification email. Please use "Resend Code" to try again or contact support.',
    email: cleanEmail,
    resend_cooldown_seconds: 60,
    expires_in_seconds: 600,
    email_delivery_status: emailResult.status,
  });
}

export async function resendOtp(req: Request, res: Response) {
  const { email } = req.body;
  const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || null;
  const userAgent = req.headers['user-agent'] || null;

  if (!email) {
    return res.status(400).json({ error: 'Email address is required' });
  }

  const cleanEmail = email.trim().toLowerCase();
  const user = (await db.prepare('SELECT id, full_name, is_verified FROM users WHERE email = ?').get(cleanEmail)) as any;
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  if (user.is_verified) {
    return res.status(400).json({ error: 'Account is already verified. Please proceed to login.' });
  }

  // Check resend cooldown from latest OTP record
  const latestOtp = (await db.prepare(`
    SELECT * FROM user_otps WHERE email = ? ORDER BY created_at DESC LIMIT 1
  `).get(cleanEmail)) as any;

  if (latestOtp && latestOtp.resend_available_at) {
    const cooldownTime = new Date(latestOtp.resend_available_at).getTime();
    const now = Date.now();
    if (cooldownTime > now) {
      const waitSeconds = Math.ceil((cooldownTime - now) / 1000);
      return res.status(429).json({
        error: `Please wait ${waitSeconds} seconds before requesting another verification code.`,
        retry_after_seconds: waitSeconds,
      });
    }
  }

  // Invalidate any active OTPs for this email
  await db.prepare('UPDATE user_otps SET is_used = TRUE WHERE email = ? AND is_used = FALSE').run(cleanEmail);

  // Generate new unpredictable 6-digit cryptographic OTP
  const rawOtp = crypto.randomInt(100000, 1000000).toString();
  const otpHash = hashOtp(rawOtp);
  const otpId = `otp-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const resendAvailableAt = new Date(Date.now() + 60 * 1000).toISOString();

  await db.prepare(`
    INSERT INTO user_otps (
      id, user_id, email, otp_hash, created_at, expires_at, resend_available_at, attempts, max_attempts, is_used
    ) VALUES (?, ?, ?, ?, NOW(), ?, ?, 0, 5, FALSE)
  `).run(otpId, user.id, cleanEmail, otpHash, expiresAt, resendAvailableAt);

  const emailResult = await sendOtpEmail({
    to: cleanEmail,
    fullName: user.full_name,
    otp: rawOtp,
    expiresInMinutes: 10,
  });

  await logAuthEvent({
    event_type: 'OTP_RESENT',
    user_id: user.id,
    email: cleanEmail,
    ip_address: ip,
    user_agent: userAgent,
    details: { otpId, emailDeliveryStatus: emailResult.status },
  });

  if (!emailResult.success) {
    console.error(`[Auth] OTP resend email delivery failed for ${cleanEmail}: ${emailResult.status} — ${emailResult.error || 'no error detail'}`);
  }

  return res.json({
    message: emailResult.success
      ? 'A new 6-digit verification code has been dispatched to your email address.'
      : 'A new verification code was generated but email delivery failed. Please try again or contact support.',
    email: cleanEmail,
    resend_cooldown_seconds: 60,
    expires_in_seconds: 600,
    email_delivery_status: emailResult.status,
  });
}

export async function verifyOtp(req: Request, res: Response) {
  const { email, otp } = req.body;
  const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || null;
  const userAgent = req.headers['user-agent'] || null;

  if (!email || !otp) {
    return res.status(400).json({ error: 'Email and OTP code are required' });
  }

  const cleanEmail = email.trim().toLowerCase();
  const cleanOtp = String(otp).trim();

  if (!/^\d{6}$/.test(cleanOtp)) {
    return res.status(400).json({ error: 'Verification code must be exactly 6 digits' });
  }

  const user = (await db.prepare('SELECT * FROM users WHERE email = ?').get(cleanEmail)) as any;
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  // Fetch the latest active OTP for this email
  const activeOtp = (await db.prepare(`
    SELECT * FROM user_otps
    WHERE email = ? AND is_used = FALSE
    ORDER BY created_at DESC
    LIMIT 1
  `).get(cleanEmail)) as any;

  if (!activeOtp) {
    return res.status(400).json({ error: 'No active verification code found. Please request a new code.' });
  }

  // 1. Expiration check (10 minutes)
  const expiresAt = new Date(activeOtp.expires_at).getTime();
  if (expiresAt < Date.now()) {
    await db.prepare('UPDATE user_otps SET is_used = TRUE WHERE id = ?').run(activeOtp.id);
    await logAuthEvent({
      event_type: 'OTP_EXPIRED',
      user_id: user.id,
      email: cleanEmail,
      ip_address: ip,
      user_agent: userAgent,
      details: { otpId: activeOtp.id },
    });
    return res.status(400).json({ error: 'Verification code has expired. Please request a new code.' });
  }

  // 2. Maximum attempts check (5 attempts)
  if (activeOtp.attempts >= activeOtp.max_attempts) {
    await db.prepare('UPDATE user_otps SET is_used = TRUE WHERE id = ?').run(activeOtp.id);
    await logAuthEvent({
      event_type: 'OTP_MAX_ATTEMPTS',
      user_id: user.id,
      email: cleanEmail,
      ip_address: ip,
      user_agent: userAgent,
      details: { otpId: activeOtp.id },
    });
    return res.status(429).json({ error: 'Maximum verification attempts exceeded. Please request a new code.' });
  }

  // 3. Timing-safe cryptographic comparison
  const candidateHash = hashOtp(cleanOtp);
  const matches = crypto.timingSafeEqual(
    Buffer.from(candidateHash, 'hex'),
    Buffer.from(activeOtp.otp_hash, 'hex')
  );

  if (!matches) {
    const newAttempts = activeOtp.attempts + 1;
    await db.prepare('UPDATE user_otps SET attempts = ? WHERE id = ?').run(newAttempts, activeOtp.id);

    await logAuthEvent({
      event_type: 'OTP_FAILED',
      user_id: user.id,
      email: cleanEmail,
      ip_address: ip,
      user_agent: userAgent,
      details: { otpId: activeOtp.id, attempts: newAttempts },
    });

    if (newAttempts >= activeOtp.max_attempts) {
      await db.prepare('UPDATE user_otps SET is_used = TRUE WHERE id = ?').run(activeOtp.id);
      return res.status(429).json({ error: 'Maximum verification attempts exceeded. Please request a new code.' });
    }

    const remaining = activeOtp.max_attempts - newAttempts;
    return res.status(400).json({
      error: `Invalid verification code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`,
      remaining_attempts: remaining,
    });
  }

  // 4. Mark OTP as used (single-use enforcement & replay protection)
  const now = new Date().toISOString();
  await db.prepare('UPDATE user_otps SET is_used = TRUE, used_at = NOW() WHERE id = ?').run(activeOtp.id);
  await db.prepare('UPDATE users SET is_verified = 1, updated_date = ? WHERE id = ?').run(now, user.id);

  await logAuthEvent({
    event_type: 'OTP_VERIFIED',
    user_id: user.id,
    email: cleanEmail,
    ip_address: ip,
    user_agent: userAgent,
    details: { otpId: activeOtp.id },
  });

  const token = generateToken({
    id: user.id,
    email: user.email,
    full_name: user.full_name,
    role: user.role,
    token_version: user.token_version || 1,
  });

  return res.json({
    message: 'Account verified successfully',
    token,
    user: {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      role: user.role,
    },
  });
}

export async function forgotPassword(req: Request, res: Response) {
  const { email } = req.body;
  const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || null;
  const userAgent = req.headers['user-agent'] || null;

  // Account enumeration protection: always return generic message
  const genericResponse = {
    message: 'If the provided email address is registered, password reset instructions have been dispatched.',
  };

  if (!email || typeof email !== 'string') {
    return res.json(genericResponse);
  }

  const cleanEmail = email.trim().toLowerCase();
  const user = (await db.prepare('SELECT id, full_name, email FROM users WHERE email = ?').get(cleanEmail)) as any;
  if (!user) {
    // Return same message, do not reveal email existence
    return res.json(genericResponse);
  }

  // 1. Invalidate any existing active reset tokens for this user
  await db.prepare('UPDATE password_resets SET is_used = TRUE WHERE user_id = ? AND is_used = FALSE').run(user.id);

  // 2. Generate cryptographically secure 32-byte reset token
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(rawToken);
  const resetId = `rst-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

  // 3. Store only the hash in PostgreSQL
  await db.prepare(`
    INSERT INTO password_resets (id, user_id, email, token_hash, created_at, expires_at, is_used)
    VALUES (?, ?, ?, ?, NOW(), ?, FALSE)
  `).run(resetId, user.id, cleanEmail, tokenHash, expiresAt);

  // 4. Send email containing the reset link (never logged, never in API response)
  const appBaseUrl = process.env.APP_URL || 'http://localhost:5173';
  const resetUrl = `${appBaseUrl}/reset-password?token=${encodeURIComponent(rawToken)}`;

  await sendPasswordResetEmail({
    to: cleanEmail,
    fullName: user.full_name,
    resetUrl,
    expiresInHours: 1,
  });

  await logAuthEvent({
    event_type: 'PASSWORD_RESET_REQUESTED',
    user_id: user.id,
    email: cleanEmail,
    ip_address: ip,
    user_agent: userAgent,
    details: { resetId },
  });

  return res.json(genericResponse);
}

export async function resetPassword(req: Request, res: Response) {
  const { token, new_password } = req.body;
  const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || null;
  const userAgent = req.headers['user-agent'] || null;

  if (!token || !new_password) {
    return res.status(400).json({ error: 'Reset token and new password are required' });
  }

  const pwdValidation = validatePasswordStrength(new_password);
  if (!pwdValidation.valid) {
    return res.status(400).json({ error: pwdValidation.error });
  }

  const tokenHash = hashToken(String(token).trim());

  // Find active matching reset token
  const resetRecord = (await db.prepare(`
    SELECT * FROM password_resets
    WHERE token_hash = ? AND is_used = FALSE
    LIMIT 1
  `).get(tokenHash)) as any;

  if (!resetRecord) {
    await logAuthEvent({
      event_type: 'PASSWORD_RESET_FAILED',
      email: 'unknown',
      ip_address: ip,
      user_agent: userAgent,
      details: { reason: 'Invalid or already used token' },
    });
    return res.status(400).json({ error: 'Invalid or expired password reset token' });
  }

  // Expiration check (1 hour)
  const expiresAt = new Date(resetRecord.expires_at).getTime();
  if (expiresAt < Date.now()) {
    await db.prepare('UPDATE password_resets SET is_used = TRUE WHERE id = ?').run(resetRecord.id);
    await logAuthEvent({
      event_type: 'PASSWORD_RESET_FAILED',
      user_id: resetRecord.user_id,
      email: resetRecord.email,
      ip_address: ip,
      user_agent: userAgent,
      details: { reason: 'Expired token', resetId: resetRecord.id },
    });
    return res.status(400).json({ error: 'Password reset token has expired. Please request a new link.' });
  }

  // Hash new password and invalidate active sessions via token_version increment
  const salt = bcrypt.genSaltSync(10);
  const password_hash = bcrypt.hashSync(new_password, salt);
  const now = new Date().toISOString();

  // Invalidate token (single-use)
  await db.prepare('UPDATE password_resets SET is_used = TRUE, used_at = NOW() WHERE id = ?').run(resetRecord.id);
  // Invalidate any other outstanding tokens for this user
  await db.prepare('UPDATE password_resets SET is_used = TRUE WHERE user_id = ?').run(resetRecord.user_id);

  // Update user password and session token_version
  await db.prepare(`
    UPDATE users
    SET password_hash = ?,
        password_changed_at = NOW(),
        token_version = COALESCE(token_version, 1) + 1,
        reset_token = NULL,
        updated_date = ?
    WHERE id = ?
  `).run(password_hash, now, resetRecord.user_id);

  await logAuthEvent({
    event_type: 'PASSWORD_RESET_COMPLETED',
    user_id: resetRecord.user_id,
    email: resetRecord.email,
    ip_address: ip,
    user_agent: userAgent,
    details: { resetId: resetRecord.id },
  });

  return res.json({ message: 'Password has been reset successfully. You may now log in with your new credentials.' });
}

export async function googleAuth(req: Request, res: Response) {
  const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || null;
  const userAgent = req.headers['user-agent'] || null;
  const requestedEmail = req.body?.email ? String(req.body.email).trim().toLowerCase() : 'unknown';

  await logAuthEvent({
    event_type: 'LOGIN_FAILED',
    email: requestedEmail,
    ip_address: ip,
    user_agent: userAgent,
    details: {
      endpoint: '/api/auth/google',
      reason: 'Google OAuth is disabled: genuine token verification not configured',
    },
  });

  return res.status(501).json({
    error: 'Google OAuth authentication is temporarily disabled pending production identity provider integration. Please sign in using your PIL email and password.',
    code: 'GOOGLE_OAUTH_DISABLED',
  });
}

export async function getCurrentUser(req: AuthenticatedRequest, res: Response) {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const user = await db.prepare('SELECT id, full_name, email, role, created_date, updated_date FROM users WHERE id = ?').get(req.user.id);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  return res.json({ user });
}
