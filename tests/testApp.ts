import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

// Force environment configuration for isolated test execution BEFORE loading any server modules
process.env.NODE_ENV = 'test';
process.env.DB_NAME = 'pil_claims_test_db';
process.env.EMAIL_TRANSPORT = 'captured';
process.env.EMAIL_PROVIDER = 'captured_test';
process.env.PORT = '5099';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

import express from 'express';
import http from 'http';
import cors from 'cors';
import { initDatabase, pool, isDatabaseReady } from '../server/src/db';
import { testConnection } from '../server/src/pgdb';
import {
  login,
  register,
  verifyOtp,
  resendOtp,
  forgotPassword,
  resetPassword,
  googleAuth,
  getCurrentUser,
  authenticate,
} from '../server/src/auth';
import { getEmailProviderStatus } from '../server/src/emailService';
import {
  getCorsConfig,
  getHelmetMiddleware,
  generalApiLimiter,
  authRateLimiter,
  sensitiveAuthLimiter,
} from '../server/src/security';
import claimsRouter from '../server/src/routes/claims';
import surveysRouter from '../server/src/routes/surveys';
import dashboardRouter from '../server/src/routes/dashboard';
import usersRouter from '../server/src/routes/users';
import uploadsRouter from '../server/src/routes/uploads';
import filesRouter from '../server/src/routes/files';
import attachmentsRouter from '../server/src/routes/attachments';
import { fetchLMSByBL } from '../server/src/lms';
import { getDailyExchangeRates } from '../server/src/rates';
import db from '../server/src/db';

export const TEST_PORT = 5099;
export const BASE_URL = `http://localhost:${TEST_PORT}`;

let server: http.Server | null = null;

export function buildTestApp() {
  const app = express();
  app.set('trust proxy', 1);

  app.use(getHelmetMiddleware());
  app.use(cors(getCorsConfig()));
  app.use(express.json({ limit: '20mb' }));
  app.use(express.urlencoded({ extended: true, limit: '20mb' }));

  // Health check endpoints
  app.get('/api/health/live', (_req, res) => {
    return res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.get('/api/health/ready', async (_req, res) => {
    const initialized = isDatabaseReady();
    const dbCheck = initialized ? await testConnection() : { ok: false };
    const ready = initialized && dbCheck.ok;
    return res.status(ready ? 200 : 503).json({
      status: ready ? 'ready' : 'not_ready',
      database: dbCheck.ok ? 'connected' : 'disconnected',
      initialized,
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/health', async (_req, res) => {
    const initialized = isDatabaseReady();
    const dbCheck = await testConnection();
    return res.json({
      status: (initialized && dbCheck.ok) ? 'healthy' : 'degraded',
      database: dbCheck.ok ? 'connected' : 'disconnected',
      initialized,
      timestamp: new Date().toISOString(),
    });
  });

  // File download and preview endpoints
  app.use('/api/files', filesRouter);
  app.use('/uploads', filesRouter);

  // Auth routes
  app.post('/api/auth/login', login);
  app.post('/api/auth/register', register);
  app.post('/api/auth/verify-otp', verifyOtp);
  app.post('/api/auth/resend-otp', resendOtp);
  app.post('/api/auth/forgot-password', forgotPassword);
  app.post('/api/auth/reset-password', resetPassword);
  app.post('/api/auth/google', googleAuth);
  app.get('/api/auth/me', authenticate, getCurrentUser);

  // Email status endpoint
  app.get('/api/email/status', authenticate, (_req, res) => res.json(getEmailProviderStatus()));

  // LMS Lookup route
  app.get('/api/lms/lookup', authenticate, async (req, res) => {
    const blNumber = req.query.bl_number as string;
    if (!blNumber) return res.status(400).json({ error: 'bl_number parameter is required' });
    const result = await fetchLMSByBL(blNumber);
    if (result.error) return res.status(404).json({ error: result.error });
    return res.json(result);
  });

  // Rates route
  app.get('/api/rates', authenticate, async (_req, res) => {
    const result = await getDailyExchangeRates();
    return res.json(result);
  });

  // Notifications
  app.get('/api/notifications', authenticate, async (req: any, res) => {
    const user = req.user;
    const rows = await db.prepare('SELECT * FROM notifications WHERE user_id = ? OR user_id IS NULL ORDER BY created_date DESC LIMIT 50').all(user.id);
    return res.json(rows);
  });

  app.put('/api/notifications/:id/read', authenticate, async (req, res) => {
    await db.prepare('UPDATE notifications SET read = 1 WHERE id = ?').run(req.params.id);
    return res.json({ success: true });
  });

  // Business Routers
  app.use('/api/claims', claimsRouter);
  app.use('/api/surveys', surveysRouter);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/upload', uploadsRouter);
  app.use('/api/attachments', attachmentsRouter);

  // Static SPA serving
  const clientDist = path.resolve(__dirname, '../client/dist');
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.use((_req, res) => {
      res.sendFile('index.html', { root: clientDist });
    });
  }

  return app;
}

export async function startTestServer(): Promise<void> {
  if (server) return;
  await initDatabase();
  const app = buildTestApp();
  await new Promise<void>((resolve) => {
    server = app.listen(TEST_PORT, () => {
      resolve();
    });
  });
}

export async function stopTestServer(): Promise<void> {
  if (server) {
    await new Promise<void>((resolve) => {
      server?.close(() => {
        server = null;
        resolve();
      });
    });
  }
}

export interface ApiResponse<T = any> {
  status: number;
  body: T;
  headers: Headers;
}

export async function requestApi<T = any>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  endpoint: string,
  body?: any,
  token?: string,
  extraHeaders?: Record<string, string>
): Promise<ApiResponse<T>> {
  const headers: Record<string, string> = { ...extraHeaders };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (body && !(body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const options: RequestInit = {
    method,
    headers,
  };

  if (body) {
    options.body = typeof body === 'object' && !(body instanceof FormData) ? JSON.stringify(body) : body;
  }

  const res = await fetch(`${BASE_URL}${endpoint}`, options);
  let data: any = {};
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      data = await res.json();
    } catch {
      data = {};
    }
  } else {
    data = await res.text();
  }

  return {
    status: res.status,
    body: data as T,
    headers: res.headers,
  };
}

export interface TestItem {
  id: string;
  name: string;
  pass: boolean;
  details?: string;
}
