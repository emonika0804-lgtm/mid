import dotenv from 'dotenv';
import path from 'path';

// Ensure .env is loaded from project root before any application module initialization
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import express from 'express';
import cors from 'cors';
import fs from 'fs';
import { initDatabase } from './db';
import { loadLMSExcel, fetchLMSByBL } from './lms';
import { getDailyExchangeRates } from './rates';
import {
  login,
  register,
  verifyOtp,
  forgotPassword,
  resetPassword,
  googleAuth,
  getCurrentUser,
  authenticate,
} from './auth';
import claimsRouter from './routes/claims';
import surveysRouter from './routes/surveys';
import dashboardRouter from './routes/dashboard';
import usersRouter from './routes/users';
import uploadsRouter from './routes/uploads';
import filesRouter from './routes/files';
import db from './db';

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// Ensure uploads directory exists (secured via filesRouter)
const uploadsDir = path.resolve(__dirname, '../../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Secure file access routes (public static serving removed)
app.use('/api/files', filesRouter);
app.use('/uploads', filesRouter);

// Initialize DB and preload LMS Excel
initDatabase().catch((e) => {
  console.error('[Database] PostgreSQL initialization error:', e);
});
try {
  loadLMSExcel();
} catch (e) {
  console.warn('LMS Excel initial preload note:', e);
}

// Auth routes
app.post('/api/auth/login', login);
app.post('/api/auth/register', register);
app.post('/api/auth/verify-otp', verifyOtp);
app.post('/api/auth/forgot-password', forgotPassword);
app.post('/api/auth/reset-password', resetPassword);
app.post('/api/auth/google', googleAuth);
app.get('/api/auth/me', authenticate, getCurrentUser);

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

// Serve static frontend in production if built
const clientDist = path.resolve(__dirname, '../../client/dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.use((_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`PIL Cargo Claim & Survey Platform server running on port ${PORT}`);
});
