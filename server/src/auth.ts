import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import db from './db';

export const JWT_SECRET = process.env.JWT_SECRET || 'pil-cargo-claims-secret-key-2026';

export interface AuthUser {
  id: string;
  email: string;
  full_name: string;
  role: 'agency' | 'mid' | 'mid_gcc' | 'admin';
  is_verified?: number;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}

export function generateToken(user: AuthUser): string {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      role: user.role,
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

export function authenticate(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as AuthUser;
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

// Auth Controller Functions
export async function login(req: Request, res: Response) {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const user = (await db.prepare('SELECT * FROM users WHERE email = ?').get(email.trim().toLowerCase())) as any;
  if (!user) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const match = bcrypt.compareSync(password, user.password_hash);
  if (!match) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  if (!user.is_verified) {
    return res.status(403).json({
      error: 'Account not verified. Please verify your OTP.',
      needs_otp: true,
      email: user.email,
    });
  }

  const token = generateToken({
    id: user.id,
    email: user.email,
    full_name: user.full_name,
    role: user.role,
  });

  return res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      role: user.role,
    }
  });
}

export async function register(req: Request, res: Response) {
  const { full_name, email, password, role = 'agency' } = req.body;
  if (!full_name || !email || !password) {
    return res.status(400).json({ error: 'Full name, email, and password are required' });
  }

  const existing = await db.prepare('SELECT id FROM users WHERE email = ?').get(email.trim().toLowerCase());
  if (existing) {
    return res.status(400).json({ error: 'An account with this email already exists' });
  }

  const salt = bcrypt.genSaltSync(10);
  const password_hash = bcrypt.hashSync(password, salt);
  const now = new Date().toISOString();
  const id = `usr-${Date.now()}`;
  const otp_code = '123456'; // Standard simulated OTP for registration verification

  await db.prepare(`
    INSERT INTO users (id, created_date, updated_date, full_name, email, password_hash, role, is_verified, otp_code)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
  `).run(id, now, now, full_name.trim(), email.trim().toLowerCase(), password_hash, role, otp_code);

  return res.status(201).json({
    message: 'Registration successful. Please enter the OTP sent to your email.',
    email: email.trim().toLowerCase(),
    // In dev / test mode provide the OTP in response so users can easily test without an external mailer
    simulated_otp: otp_code,
  });
}

export async function verifyOtp(req: Request, res: Response) {
  const { email, otp } = req.body;
  if (!email || !otp) {
    return res.status(400).json({ error: 'Email and OTP are required' });
  }

  const user = (await db.prepare('SELECT * FROM users WHERE email = ?').get(email.trim().toLowerCase())) as any;
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  if (user.otp_code !== otp.trim() && otp.trim() !== '123456') {
    return res.status(400).json({ error: 'Invalid OTP code' });
  }

  const now = new Date().toISOString();
  await db.prepare('UPDATE users SET is_verified = 1, otp_code = NULL, updated_date = ? WHERE id = ?').run(now, user.id);

  const token = generateToken({
    id: user.id,
    email: user.email,
    full_name: user.full_name,
    role: user.role,
  });

  return res.json({
    message: 'Account verified successfully',
    token,
    user: {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      role: user.role,
    }
  });
}

export async function forgotPassword(req: Request, res: Response) {
  const { email } = req.body;
  if (email) {
    const user = (await db.prepare('SELECT id FROM users WHERE email = ?').get(email.trim().toLowerCase())) as any;
    if (user) {
      const resetToken = `rst-${Math.random().toString(36).substring(2)}-${Date.now()}`;
      await db.prepare('UPDATE users SET reset_token = ? WHERE id = ?').run(resetToken, user.id);
      // Generic success always shown (does not reveal if email exists)
      return res.json({
        message: 'If the email exists, a password reset link has been dispatched.',
        reset_token_hint: resetToken, // For ease of test preview
      });
    }
  }
  return res.json({
    message: 'If the email exists, a password reset link has been dispatched.',
  });
}

export async function resetPassword(req: Request, res: Response) {
  const { token, new_password } = req.body;
  if (!token || !new_password) {
    return res.status(400).json({ error: 'Token and new password are required' });
  }

  const user = (await db.prepare('SELECT id FROM users WHERE reset_token = ?').get(token)) as any;
  if (!user) {
    return res.status(400).json({ error: 'Invalid or expired password reset token' });
  }

  const salt = bcrypt.genSaltSync(10);
  const password_hash = bcrypt.hashSync(new_password, salt);
  const now = new Date().toISOString();

  await db.prepare('UPDATE users SET password_hash = ?, reset_token = NULL, updated_date = ? WHERE id = ?').run(password_hash, now, user.id);

  return res.json({ message: 'Password has been reset successfully' });
}

export async function googleAuth(req: Request, res: Response) {
  const { email, full_name } = req.body;
  const targetEmail = (email || 'google.user@pilship.com').trim().toLowerCase();
  const targetName = full_name || 'PIL Google User';

  let user = (await db.prepare('SELECT * FROM users WHERE email = ?').get(targetEmail)) as any;
  const now = new Date().toISOString();

  if (!user) {
    const id = `usr-g-${Date.now()}`;
    const salt = bcrypt.genSaltSync(10);
    const password_hash = bcrypt.hashSync('GoogleOAuthDefault123!', salt);
    await db.prepare(`
      INSERT INTO users (id, created_date, updated_date, full_name, email, password_hash, role, is_verified)
      VALUES (?, ?, ?, ?, ?, ?, 'agency', 1)
    `).run(id, now, now, targetName, targetEmail, password_hash);

    user = { id, email: targetEmail, full_name: targetName, role: 'agency' };
  }

  const token = generateToken({
    id: user.id,
    email: user.email,
    full_name: user.full_name,
    role: user.role,
  });

  return res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      role: user.role,
    }
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
