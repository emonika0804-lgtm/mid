import dotenv from 'dotenv';
import path from 'path';

// Ensure .env is loaded from project root before any application module initialization
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import express from 'express';
import cors from 'cors';
import fs from 'fs';
import { initDatabase, isDatabaseReady } from './db';
import { loadLMSExcel, fetchLMSByBL } from './lms';
import { getDailyExchangeRates } from './rates';
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
} from './auth';
import { getEmailProviderStatus } from './emailService';
import {
  getCorsConfig,
  getHelmetMiddleware,
  generalApiLimiter,
  authRateLimiter,
  sensitiveAuthLimiter,
  errorHandler,
} from './security';
import claimsRouter from './routes/claims';
import surveysRouter from './routes/surveys';
import dashboardRouter from './routes/dashboard';
import usersRouter from './routes/users';
import uploadsRouter from './routes/uploads';
import filesRouter from './routes/files';
import attachmentsRouter from './routes/attachments';
import db from './db';
import { testConnection, pool } from './pgdb';
import swaggerUi from 'swagger-ui-express';
import { openapiSpecification, writeOpenApiFile } from './swagger';

const app = express();
const PORT = Number(process.env.PORT) || 5000;
const SERVER_START_TIME = Date.now();

// 1. Trust proxy for rate limiting behind reverse proxies (Nginx / load balancers)
app.set('trust proxy', 1);

// ─── Liveness Health Check (unauthenticated, zero DB dependency, pre-middleware) ───
app.get('/api/health/live', (_req, res) => {
  return res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 2. Helmet HTTP Security Headers (CSP, Frameguard, Referrer-Policy, nosniff, HSTS)
app.use(getHelmetMiddleware());

// 3. CORS with Configurable Allowlist
app.use(cors(getCorsConfig()));

// 4. Request Body Parsers (with size limits)
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// 5. Global API Rate Limiter
app.use('/api/', generalApiLimiter);

// Ensure uploads directory exists (legacy compatibility — new uploads go to PostgreSQL BYTEA)
const uploadsDir = path.resolve(__dirname, '../../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Secure file access routes — ALL file downloads served directly from PostgreSQL BYTEA
app.use('/api/files', filesRouter);
app.use('/uploads', filesRouter);



// Auth routes with dedicated rate limiting
app.post('/api/auth/login', authRateLimiter, login);
app.post('/api/auth/register', authRateLimiter, register);
app.post('/api/auth/verify-otp', sensitiveAuthLimiter, verifyOtp);
app.post('/api/auth/resend-otp', sensitiveAuthLimiter, resendOtp);
app.post('/api/auth/forgot-password', sensitiveAuthLimiter, forgotPassword);
app.post('/api/auth/reset-password', sensitiveAuthLimiter, resetPassword);
app.post('/api/auth/google', authRateLimiter, googleAuth);
app.get('/api/auth/me', authenticate, getCurrentUser);

// Email Provider Status endpoint
app.get('/api/email/status', authenticate, (_req, res) => {
  res.json(getEmailProviderStatus());
});

// LMS Lookup route
app.get('/api/lms/lookup', authenticate, async (req, res) => {
  const blNumber = req.query.bl_number as string;
  if (!blNumber) {
    return res.status(400).json({ error: 'bl_number parameter is required' });
  }
  const result = await fetchLMSByBL(blNumber);
  if (result.error) {
    return res.status(404).json({ error: result.error });
  }
  return res.json(result);
});

// Currency Rates route (Frankfurter API with 1-day cache & fallback)
app.get('/api/rates', authenticate, async (_req, res) => {
  const result = await getDailyExchangeRates();
  return res.json(result);
});

// Notifications routes
app.get('/api/notifications', authenticate, async (req: any, res) => {
  const user = req.user;
  const rows = await db.prepare('SELECT * FROM notifications WHERE user_id = ? OR user_id IS NULL ORDER BY created_date DESC LIMIT 50').all(user.id);
  return res.json(rows);
});

app.put('/api/notifications/read-all', authenticate, async (req: any, res) => {
  const user = req.user;
  await db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ? OR user_id IS NULL').run(user.id);
  return res.json({ success: true });
});

app.put('/api/notifications/:id/read', authenticate, async (req, res) => {
  await db.prepare('UPDATE notifications SET read = 1 WHERE id = ?').run(req.params.id);
  return res.json({ success: true });
});

// Business Entity Routers
app.use('/api/claims', claimsRouter);
app.use('/api/surveys', surveysRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/users', usersRouter);
app.use('/api/upload', uploadsRouter);
app.use('/api/attachments', attachmentsRouter);

// ─── OpenAPI 3.0 Documentation & Swagger UI ───
// Raw OpenAPI specification endpoint
app.get('/api/docs/openapi.json', (_req, res) => {
  res.setHeader('Content-Type', 'application/json');
  return res.json(openapiSpecification);
});

// Interactive Swagger UI documentation console
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openapiSpecification, {
  customSiteTitle: 'PIL Cargo Claim & Survey API Documentation',
  customCss: '.swagger-ui .topbar { display: none }',
}));

// Convenience redirect /docs -> /api/docs
app.get('/docs', (_req, res) => {
  return res.redirect('/api/docs');
});

// ─── Health Check Endpoints (unauthenticated, lightweight) ───
// Readiness: is the application ready to serve traffic? (Requires database initialization)
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

// Combined health endpoint
app.get('/api/health', async (_req, res) => {
  const uptimeSeconds = Math.round((Date.now() - SERVER_START_TIME) / 1000);
  const initialized = isDatabaseReady();
  const dbCheck = await testConnection();
  let version = '1.0.0';
  try {
    const pkgPath = path.resolve(__dirname, '../../package.json');
    const pkgJson = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    version = pkgJson.version || version;
  } catch { /* ignore */ }
  return res.json({
    status: (initialized && dbCheck.ok) ? 'healthy' : 'degraded',
    version,
    uptime: uptimeSeconds,
    database: dbCheck.ok ? 'connected' : 'disconnected',
    initialized,
    environment: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString(),
  });
});

// Serve static frontend in production if built
const clientDist = path.resolve(__dirname, '../../client/dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.use((_req, res) => {
    res.sendFile('index.html', { root: clientDist });
  });
}

// 6. Centralized Error Handling Middleware (Sanitizes errors, prevents stack leaks)
app.use(errorHandler);

/**
 * Asynchronous server bootstrap lifecycle:
 * 1. Awaits database initialization and schema verification before opening port.
 * 2. If initialization fails:
 *    - Does NOT open HTTP listening port.
 *    - Logs fatal error.
 *    - Closes connection pool gracefully (in production/standalone mode).
 *    - Exits process with non-zero exit code (in production/standalone mode).
 * 3. Preloads LMS Excel data.
 * 4. Binds Express HTTP listener only after database is completely ready.
 */
export async function startServer(port: number = PORT, initFn: () => Promise<void> = initDatabase): Promise<any> {
  try {
    // 1. Await database initialization and schema verification before opening port
    await initFn();

    // 2. Preload LMS Excel mock data
    try {
      loadLMSExcel();
    } catch (e) {
      console.warn('LMS Excel initial preload note:', e);
    }

    // 3. Open HTTP listening port only after successful database initialization
    return await new Promise((resolve) => {
      const serverInstance = app.listen(port, '0.0.0.0', () => {
        console.log(`PIL Cargo Claim & Survey Platform server running on port ${port} (0.0.0.0)`);
        resolve(serverInstance);
      });
    });
  } catch (err: any) {
    console.error('[Database] Fatal PostgreSQL initialization error:', err?.message || err);
    if (process.env.NODE_ENV !== 'test') {
      try {
        await pool.end();
      } catch (poolErr) {
        console.error('[Database] Error closing PostgreSQL pool during shutdown:', poolErr);
      }
      process.exit(1);
    }
    throw err;
  }
}

// Automatically start server unless running under test runner
if (process.env.NODE_ENV !== 'test') {
  startServer().catch(() => {
    // Fatal error handled and logged inside startServer
  });
}

export { app };
export default app;
