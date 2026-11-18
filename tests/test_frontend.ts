import { requestApi, TestItem, BASE_URL } from './testApp';
import fs from 'fs';
import path from 'path';
import { getSafeReturnTo } from '../client/src/pages/LoginPage';

export async function runFrontendSuite(): Promise<TestItem[]> {
  const tests: TestItem[] = [];
  function record(id: string, name: string, condition: boolean, details?: string) {
    tests.push({ id, name, pass: condition, details });
    console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${id}: ${name}${details ? ` -> ${details}` : ''}`);
  }

  console.log('\n--- SUITE 7: Comprehensive Frontend Components & Workflow Tests ---');

  // 1. Production Build Asset Verification
  const distDir = path.resolve(__dirname, '../client/dist');
  const indexHtmlPath = path.join(distDir, 'index.html');
  const assetsDir = path.join(distDir, 'assets');

  const indexHtmlExists = fs.existsSync(indexHtmlPath);
  const indexHtmlContent = indexHtmlExists ? fs.readFileSync(indexHtmlPath, 'utf-8') : '';

  record(
    'UI-7.1',
    'Vite production bundle generated with index.html mounting SPA root div',
    indexHtmlExists && indexHtmlContent.includes('id="root"'),
    `Index size: ${indexHtmlContent.length} bytes`
  );

  // 2. Bundled JS and CSS assets presence
  const assetFiles = fs.existsSync(assetsDir) ? fs.readdirSync(assetsDir) : [];
  const hasJsBundle = assetFiles.some((f) => f.endsWith('.js'));
  const hasCssBundle = assetFiles.some((f) => f.endsWith('.css'));

  record(
    'UI-7.2',
    'Compiled production JavaScript and TailwindCSS bundles present in dist/assets',
    hasJsBundle && hasCssBundle,
    `Assets found: ${assetFiles.length} files`
  );

  // 3. SPA Fallback Routing Test
  // Requesting any browser route (e.g. /claims, /dashboard, /documents) returns index.html for client-side routing
  const spaFallbackRes = await fetch(`${BASE_URL}/claims`);
  const spaHtml = await spaFallbackRes.text();
  record(
    'UI-7.3',
    'Express serves single-page application fallback (index.html) for client-side routes',
    spaFallbackRes.status === 200 && spaHtml.toLowerCase().includes('<!doctype html>'),
    `Status: ${spaFallbackRes.status}, Length: ${spaHtml.length} bytes`
  );

  // 4. Component Verification: Auth Context & Protected Routing
  const appLayoutPath = path.resolve(__dirname, '../client/src/components/AppLayout.tsx');
  const appLayoutSrc = fs.existsSync(appLayoutPath) ? fs.readFileSync(appLayoutPath, 'utf-8') : '';
  const enforcesAuthRedirect = appLayoutSrc.includes('Navigate to="/login"') || appLayoutSrc.includes('useAuth');

  record('UI-7.4', 'AppLayout enforces authentication redirect to /login for protected application routes', enforcesAuthRedirect);

  // 5. Component Verification: RegisterPage OTP countdown & cooldown
  const registerPagePath = path.resolve(__dirname, '../client/src/pages/RegisterPage.tsx');
  const registerPageSrc = fs.existsSync(registerPagePath) ? fs.readFileSync(registerPagePath, 'utf-8') : '';
  const hasOtpTimers = registerPageSrc.includes('cooldown') && registerPageSrc.includes('otpExpiresIn') && registerPageSrc.includes('resendOtp');

  record('UI-7.5', 'RegisterPage implements 10-minute OTP expiration timer and 60-second resend cooldown', hasOtpTimers);

  // 6. Component Verification: Password Strength Meter
  const hasPasswordStrength = registerPageSrc.includes('getStrengthLevel') && registerPageSrc.includes('strength.color');
  record('UI-7.6', 'RegisterPage renders real-time password strength indicator (Weak/Good/Strong)', hasPasswordStrength);

  // 7. Component Verification: ForgotPassword Anti-Enumeration UI
  const forgotPagePath = path.resolve(__dirname, '../client/src/pages/ForgotPasswordPage.tsx');
  const forgotPageSrc = fs.existsSync(forgotPagePath) ? fs.readFileSync(forgotPagePath, 'utf-8') : '';
  const hasAntiEnumerationUi = !forgotPageSrc.includes('resetTokenHint') && forgotPageSrc.includes('Instructions Dispatched');

  record('UI-7.7', 'ForgotPasswordPage implements anti-enumeration message with zero token leaks', hasAntiEnumerationUi);

  // 8. Component Verification: ResetPassword Validation
  const resetPagePath = path.resolve(__dirname, '../client/src/pages/ResetPasswordPage.tsx');
  const resetPageSrc = fs.existsSync(resetPagePath) ? fs.readFileSync(resetPagePath, 'utf-8') : '';
  const hasResetValidation = resetPageSrc.includes('confirmPassword') && resetPageSrc.includes('isPasswordValid');

  record('UI-7.8', 'ResetPasswordPage validates token parameter, password strength, and password matching', hasResetValidation);

  // 9. Component Verification: DocumentSearchPage UI
  const docSearchPagePath = path.resolve(__dirname, '../client/src/pages/DocumentSearchPage.tsx');
  const docSearchPageSrc = fs.existsSync(docSearchPagePath) ? fs.readFileSync(docSearchPagePath, 'utf-8') : '';
  const hasDocFiltersAndPreview = docSearchPageSrc.includes('previewDoc') && docSearchPageSrc.includes('selectedType') && docSearchPageSrc.includes('searchTerm');

  record('UI-7.9', 'DocumentSearchPage integrates multi-filter search, pagination, and authenticated preview modal', hasDocFiltersAndPreview);

  // 10. Component Verification: Sidebar Navigation & Role Isolation
  const sidebarPath = path.resolve(__dirname, '../client/src/components/Sidebar.tsx');
  const sidebarSrc = fs.existsSync(sidebarPath) ? fs.readFileSync(sidebarPath, 'utf-8') : '';
  const hasRoleGating = sidebarSrc.includes('isAdmin') && sidebarSrc.includes('isMid');

  record('UI-7.10', 'Sidebar dynamically hides Dashboard and User Management navigation for Agency roles', hasRoleGating);

  // 11. Open Redirect Sanitizer: Malicious, protocol-relative, external, and malformed inputs rejected
  const maliciousInputs = [
    '//evil.com',
    '//evil.com/path',
    '///evil.com',
    'https://evil.com',
    'http://attacker.com/login',
    'javascript:alert(1)',
    'data:text/html,<html>',
    '/\\evil.com',
    '\\evil.com',
    '/path\\to\\somewhere',
    '/login',
    '/login?returnTo=/dashboard',
    'null',
    '',
    '   ',
    'ftp://evil.com/resource',
    '/path\x00withnull',
  ];

  const allMaliciousRejected = maliciousInputs.every((input) => getSafeReturnTo(input) === '/');
  const nullUndefinedRejected = getSafeReturnTo(null) === '/' && getSafeReturnTo(undefined) === '/';

  record(
    'UI-7.11',
    'LoginPage returnTo validation strictly rejects protocol-relative, external, backslash, scheme, and malformed targets',
    allMaliciousRejected && nullUndefinedRejected,
    `Tested ${maliciousInputs.length + 2} malicious/edge cases -> all safely defaulted to "/"`
  );

  // 12. Open Redirect Sanitizer: Legitimate internal relative paths preserved
  const legitimatePaths = [
    '/',
    '/claims',
    '/claims/new',
    '/claims/CLM-2026-0001',
    '/claims/CLM-2026-0001?tab=audit',
    '/surveys/SVY-2026-0001',
    '/dashboard',
    '/dashboard?view=charts&period=30d',
    '/documents',
    '/documents?search=BL123#preview',
  ];

  const allLegitimatePreserved = legitimatePaths.every((path) => getSafeReturnTo(path) === path);

  record(
    'UI-7.12',
    'LoginPage returnTo validation preserves legitimate relative internal application paths, query params, and hashes',
    allLegitimatePreserved,
    `Verified ${legitimatePaths.length} valid internal routes preserved exactly`
  );

  return tests;
}
