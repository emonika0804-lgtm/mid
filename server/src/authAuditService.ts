import db from './db';
import crypto from 'crypto';

export type AuthEventType =
  | 'OTP_GENERATED'
  | 'OTP_VERIFIED'
  | 'OTP_FAILED'
  | 'OTP_EXPIRED'
  | 'OTP_MAX_ATTEMPTS'
  | 'OTP_RESENT'
  | 'PASSWORD_RESET_REQUESTED'
  | 'PASSWORD_RESET_COMPLETED'
  | 'PASSWORD_RESET_FAILED'
  | 'LOGIN_SUCCESS'
  | 'LOGIN_FAILED'
  | 'USER_REGISTERED';

export interface AuthAuditEntry {
  event_type: AuthEventType;
  user_id?: string | null;
  email: string;
  ip_address?: string | null;
  user_agent?: string | null;
  details?: Record<string, any>;
}

/**
 * Log an authentication security event.
 * Never logs raw passwords, plaintext tokens, or raw OTP codes.
 */
export async function logAuthEvent(entry: AuthAuditEntry): Promise<void> {
  const id = `aud-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const sanitizedDetails = { ...(entry.details || {}) };

  // Strict sanitization: ensure sensitive fields are purged
  delete sanitizedDetails.password;
  delete sanitizedDetails.new_password;
  delete sanitizedDetails.token;
  delete sanitizedDetails.otp;
  delete sanitizedDetails.otp_code;
  delete sanitizedDetails.password_hash;

  try {
    await db.prepare(`
      INSERT INTO auth_audit_logs (
        id, event_type, user_id, email, ip_address, user_agent, details, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
    `).run(
      id,
      entry.event_type,
      entry.user_id || null,
      entry.email.trim().toLowerCase(),
      entry.ip_address || null,
      entry.user_agent || null,
      JSON.stringify(sanitizedDetails)
    );
  } catch (err: any) {
    console.warn('[AuthAudit] Failed to write audit event:', err?.message || err);
  }
}
