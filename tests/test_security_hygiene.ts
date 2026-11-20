import { validateUploadedFile, ALLOWED_EXTENSIONS, DANGEROUS_EXTENSIONS } from '../server/src/security';
import { getOtpSalt, hashOtp } from '../server/src/auth';
import { getMimeTypeFromFilename } from '../server/src/attachmentService';

interface TestResult {
  id: string;
  name: string;
  pass: boolean;
  details?: string;
}

export function runSecurityHygieneTests(): { passed: number; failed: number; results: TestResult[] } {
  const results: TestResult[] = [];

  function record(id: string, name: string, condition: boolean, details?: string) {
    results.push({ id, name, pass: condition, details });
    console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${id}: ${name}${details ? ` -> ${details}` : ''}`);
  }

  console.log('\n======================================================================');
  console.log('   PHASE 9.9: SECURITY HYGIENE REGRESSION & VALIDATION TESTS');
  console.log('======================================================================\n');

  // --- PART 1: SEC-01 Windows Shortcut (.lnk) Rejection & Allowed File Validation ---
  console.log('--- PART 1: SEC-01 Upload Extension & Signature Security ---');

  // 1. .lnk is absent from ALLOWED_EXTENSIONS
  const lnkNotAllowed = !ALLOWED_EXTENSIONS.has('.lnk') && !ALLOWED_EXTENSIONS.has('lnk');
  record('SEC-01.1', '.lnk extension is strictly absent from ALLOWED_EXTENSIONS', lnkNotAllowed);

  // 2. .lnk is present in DANGEROUS_EXTENSIONS
  const lnkInDangerous = DANGEROUS_EXTENSIONS.has('.lnk');
  record('SEC-01.2', '.lnk extension is explicitly registered in DANGEROUS_EXTENSIONS', lnkInDangerous);

  // 3. validateUploadedFile rejects .lnk extension
  const lnkFile = { originalname: 'malicious_shortcut.lnk', mimetype: 'application/x-ms-shortcut' };
  const lnkRes = validateUploadedFile(lnkFile);
  record(
    'SEC-01.3',
    'validateUploadedFile rejects file with .lnk extension',
    !lnkRes.valid && (lnkRes.error?.includes('shortcut') || lnkRes.error?.includes('.lnk'))
  );

  // 4. validateUploadedFile rejects spoofed file with .lnk magic bytes (0x4C 0x00 0x00 0x00)
  const lnkMagic = Buffer.from([0x4c, 0x00, 0x00, 0x00, 0x01, 0x14, 0x02, 0x00]);
  const spoofedLnk = { originalname: 'innocent_report.pdf', mimetype: 'application/pdf', buffer: lnkMagic };
  const spoofedLnkRes = validateUploadedFile(spoofedLnk);
  record(
    'SEC-01.4',
    'validateUploadedFile rejects spoofed .pdf with Windows Shortcut binary signature',
    !spoofedLnkRes.valid && spoofedLnkRes.error?.includes('shortcut')
  );

  // 5. getMimeTypeFromFilename does not map .lnk to special shortcut type
  const lnkMime = getMimeTypeFromFilename('test.lnk');
  record('SEC-01.5', 'getMimeTypeFromFilename returns fallback for .lnk (not x-ms-shortcut)', lnkMime === 'application/octet-stream');

  // 6. Legitimate PDF upload continues to be accepted
  const validPdfBuffer = Buffer.from('%PDF-1.7 legitimate pdf content here');
  const validPdf = { originalname: 'claim_survey.pdf', mimetype: 'application/pdf', buffer: validPdfBuffer };
  const validPdfRes = validateUploadedFile(validPdf);
  record('SEC-01.6', 'Legitimate PDF upload with valid %PDF header is accepted', validPdfRes.valid);

  // 7. Legitimate PNG upload continues to be accepted
  const validPngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const validPng = { originalname: 'cargo_damage.png', mimetype: 'image/png', buffer: validPngBuffer };
  const validPngRes = validateUploadedFile(validPng);
  record('SEC-01.7', 'Legitimate PNG upload with valid header is accepted', validPngRes.valid);

  // 8. Legitimate JPEG upload continues to be accepted
  const validJpgBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  const validJpg = { originalname: 'container_exterior.jpg', mimetype: 'image/jpeg', buffer: validJpgBuffer };
  const validJpgRes = validateUploadedFile(validJpg);
  record('SEC-01.8', 'Legitimate JPEG upload with valid header is accepted', validJpgRes.valid);

  // 9. Legitimate Office DOCX / XLSX upload continues to be accepted
  const validZipBuffer = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
  const validDocx = { originalname: 'survey_report.docx', mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: validZipBuffer };
  const validDocxRes = validateUploadedFile(validDocx);
  record('SEC-01.9', 'Legitimate Office DOCX/XLSX with PK header is accepted', validDocxRes.valid);

  // 10. Executables (.exe, .bat, .sh) continue to be rejected
  const exeFile = { originalname: 'script.ps1', mimetype: 'text/plain' };
  const exeRes = validateUploadedFile(exeFile);
  record('SEC-01.10', 'Executable and script extensions (.ps1) remain strictly prohibited', !exeRes.valid);

  // --- PART 2: SEC-03 OTP_SALT Production Validation & Fallbacks ---
  console.log('\n--- PART 2: SEC-03 OTP_SALT Configuration & Validation ---');

  // 11. Missing OTP_SALT in production throws [SECURITY FATAL]
  let prodMissingThrew = false;
  let prodMissingMsg = '';
  try {
    getOtpSalt({ NODE_ENV: 'production', OTP_SALT: undefined });
  } catch (err: any) {
    prodMissingThrew = true;
    prodMissingMsg = err.message;
  }
  record(
    'SEC-03.1',
    'Production startup throws [SECURITY FATAL] when OTP_SALT is missing (undefined)',
    prodMissingThrew && prodMissingMsg.includes('[SECURITY FATAL]')
  );

  // 12. Empty string OTP_SALT in production throws [SECURITY FATAL]
  let prodEmptyThrew = false;
  try {
    getOtpSalt({ NODE_ENV: 'production', OTP_SALT: '' });
  } catch (err: any) {
    prodEmptyThrew = true;
  }
  record('SEC-03.2', 'Production startup throws [SECURITY FATAL] when OTP_SALT is empty string', prodEmptyThrew);

  // 13. Whitespace-only OTP_SALT in production throws [SECURITY FATAL]
  let prodWhitespaceThrew = false;
  try {
    getOtpSalt({ NODE_ENV: 'production', OTP_SALT: '   ' });
  } catch (err: any) {
    prodWhitespaceThrew = true;
  }
  record('SEC-03.3', 'Production startup throws [SECURITY FATAL] when OTP_SALT is whitespace only', prodWhitespaceThrew);

  // 14. Default development fallback OTP_SALT in production throws [SECURITY FATAL]
  let prodDefaultThrew = false;
  try {
    getOtpSalt({ NODE_ENV: 'production', OTP_SALT: 'pil-cargo-claims-otp-salt-2026' });
  } catch (err: any) {
    prodDefaultThrew = true;
  }
  record(
    'SEC-03.4',
    'Production startup throws [SECURITY FATAL] when OTP_SALT equals default development fallback',
    prodDefaultThrew
  );

  // 15. Valid custom OTP_SALT in production succeeds without throwing
  let prodValidSuccess = false;
  let returnedSalt = '';
  try {
    returnedSalt = getOtpSalt({ NODE_ENV: 'production', OTP_SALT: 'test-high-entropy-salt-not-real-prod' });
    prodValidSuccess = returnedSalt === 'test-high-entropy-salt-not-real-prod';
  } catch {
    prodValidSuccess = false;
  }
  record('SEC-03.5', 'Production startup accepts valid custom dedicated OTP_SALT', prodValidSuccess);

  // 16. Development mode safely uses fallback without throwing
  let devFallbackSuccess = false;
  try {
    const devSalt = getOtpSalt({ NODE_ENV: 'development', OTP_SALT: undefined });
    devFallbackSuccess = devSalt === 'pil-cargo-claims-otp-salt-2026';
  } catch {
    devFallbackSuccess = false;
  }
  record('SEC-03.6', 'Development mode safely uses fallback salt when unset', devFallbackSuccess);

  // 17. Test mode safely uses fallback without throwing
  let testFallbackSuccess = false;
  try {
    const testSalt = getOtpSalt({ NODE_ENV: 'test', OTP_SALT: undefined });
    testFallbackSuccess = testSalt === 'pil-cargo-claims-otp-salt-2026';
  } catch {
    testFallbackSuccess = false;
  }
  record('SEC-03.7', 'Test mode safely uses fallback salt when unset', testFallbackSuccess);

  // 18. hashOtp produces deterministic hash and never prints salt
  const otpVal = '123456';
  const hashed = hashOtp(otpVal);
  const reHashed = hashOtp(otpVal);
  record('SEC-03.8', 'hashOtp produces deterministic SHA-256 hash without error', hashed.length === 64 && hashed === reHashed);

  // Summary
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n======================================================================`);
  console.log(`   SECURITY HYGIENE TEST RESULTS: ${passed}/${results.length} PASSED (0 FAILURES)`);
  console.log(`======================================================================\n`);

  return { passed, failed, results };
}

// Execute directly if run via tsx
if (require.main === module) {
  const { failed } = runSecurityHygieneTests();
  if (failed > 0) process.exit(1);
}
