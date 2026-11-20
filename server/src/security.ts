import { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cors, { CorsOptions } from 'cors';
import path from 'path';

/**
 * 1. CORS Configuration with Configurable Allowlist
 */
export function getCorsConfig(): CorsOptions {
  // Configurable comma-separated origins from environment
  const envOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim()).filter(Boolean)
    : [];

  const defaultOrigins = [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:5000',
    'http://127.0.0.1:5000',
  ];

  const allowedOrigins = Array.from(new Set([...defaultOrigins, ...envOrigins]));

  return {
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, curl, server-to-server)
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      } else {
        const msg = `CORS policy violation: Origin ${origin} is not in the allowed list.`;
        return callback(new Error(msg), false);
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
    exposedHeaders: ['Content-Disposition', 'Content-Length', 'Content-Type'],
    maxAge: 86400, // 24 hours
  };
}

/**
 * 2. Helmet Security Headers Configuration
 */
export function getHelmetMiddleware() {
  const isProduction = process.env.NODE_ENV === 'production';

  return helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"], // Needed for Vite React bundles
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc: ["'self'", 'data:', 'blob:'], // blob: required for in-memory BYTEA preview
        frameSrc: ["'self'", 'blob:'], // blob: required for PDF in-browser preview
        connectSrc: ["'self'", 'https://api.frankfurter.app'], // Live exchange rates API
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: isProduction ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false, // Prevents blocking local resources in SPA/dev
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    xContentTypeOptions: true,
    xDnsPrefetchControl: { allow: false },
    xFrameOptions: { action: 'sameorigin' },
    hsts: isProduction ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false,
  });
}

/**
 * 3. Rate Limiters (express-rate-limit)
 */

// Stricter limits for authentication endpoints (prevent brute-force)
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30, // 30 attempts per 15 minutes per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many authentication attempts from this IP address. Please try again after 15 minutes.',
    code: 'RATE_LIMIT_EXCEEDED',
  },
  skipSuccessfulRequests: false,
});

// Sensitive password reset / OTP verification rate limiter
export const sensitiveAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many verification requests. Please try again after 15 minutes.',
    code: 'RATE_LIMIT_EXCEEDED',
  },
});

// File upload rate limiter
export const uploadRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60, // 60 uploads per 15 minutes per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Upload rate limit exceeded. Please wait before uploading more documents.',
    code: 'UPLOAD_RATE_LIMIT_EXCEEDED',
  },
});

// Search API rate limiter
export const searchRateLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 120, // 120 queries per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Search rate limit exceeded. Please throttle your queries.',
    code: 'SEARCH_RATE_LIMIT_EXCEEDED',
  },
});

// General API rate limiter
export const generalApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000, // 1000 requests per 15 minutes
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many requests from this client. Please try again later.',
    code: 'RATE_LIMIT_EXCEEDED',
  },
});

/**
 * 4. File Upload Validation & Sanitization
 */
export const DANGEROUS_EXTENSIONS = new Set([
  '.exe', '.bat', '.cmd', '.sh', '.vbs', '.ps1', '.msi', '.scr',
  '.jar', '.com', '.pif', '.hta', '.cpl', '.php', '.jsp', '.asp',
  '.aspx', '.py', '.rb', '.pl', '.cgi', '.dll', '.so', '.dylib', '.lnk'
]);

export const ALLOWED_EXTENSIONS = new Set([
  '.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg',
  '.doc', '.docx', '.xls', '.xlsx', '.csv', '.txt', '.zip'
]);

export function validateUploadedFile(file: { originalname: string; mimetype: string; buffer?: Buffer }): { valid: boolean; error?: string } {
  if (!file || !file.originalname) {
    return { valid: false, error: 'File metadata is missing or invalid.' };
  }

  const ext = path.extname(file.originalname).toLowerCase();

  // Check dangerous executable, script, or shortcut extension
  if (DANGEROUS_EXTENSIONS.has(ext) || ext === '.lnk') {
    return { valid: false, error: `Upload rejected: Executable, script, and shortcut file types (${ext}) are strictly prohibited.` };
  }

  // Check allowed extension
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return { valid: false, error: `Upload rejected: File extension (${ext}) is not permitted. Allowed: PDF, Images, Spreadsheets, Documents, Text.` };
  }

  // Validate file signature / magic bytes if buffer is present
  if (file.buffer && file.buffer.length >= 4) {
    const magic = file.buffer.subarray(0, 4);

    // Reject Windows Shortcut (.lnk) magic bytes (0x4C 0x00 0x00 0x00) regardless of extension
    if (magic[0] === 0x4C && magic[1] === 0x00 && magic[2] === 0x00 && magic[3] === 0x00) {
      return { valid: false, error: 'File signature mismatch: Windows shortcut (.lnk) binary signatures are strictly prohibited.' };
    }

    // PDF signature: %PDF (0x25 0x50 0x44 0x46)
    if (ext === '.pdf') {
      const isPdf = magic[0] === 0x25 && magic[1] === 0x50 && magic[2] === 0x44 && magic[3] === 0x46;
      if (!isPdf) return { valid: false, error: 'File signature mismatch: File claims to be PDF but binary header is invalid.' };
    }

    // PNG signature: 0x89 0x50 0x4E 0x47
    if (ext === '.png') {
      const isPng = magic[0] === 0x89 && magic[1] === 0x50 && magic[2] === 0x4E && magic[3] === 0x47;
      if (!isPng) return { valid: false, error: 'File signature mismatch: File claims to be PNG but binary header is invalid.' };
    }

    // JPEG signature: 0xFF 0xD8 0xFF
    if (ext === '.jpg' || ext === '.jpeg') {
      const isJpg = magic[0] === 0xFF && magic[1] === 0xD8 && magic[2] === 0xFF;
      if (!isJpg) return { valid: false, error: 'File signature mismatch: File claims to be JPEG but binary header is invalid.' };
    }

    // Modern Office / ZIP formats (.docx, .xlsx, .zip): PK\x03\x04 (0x50 0x4B 0x03 0x04)
    if (ext === '.docx' || ext === '.xlsx' || ext === '.zip') {
      const isZip = magic[0] === 0x50 && magic[1] === 0x4B && magic[2] === 0x03 && magic[3] === 0x04;
      if (!isZip) return { valid: false, error: 'File signature mismatch: File claims to be Office OpenXML or ZIP archive but binary header is invalid.' };
    }

    // Legacy Office formats (.doc, .xls): OLE2 compound document (0xD0 0xCF 0x11 0xE0 0xA1 0xB1 0x1A 0xE1)
    if (ext === '.doc' || ext === '.xls') {
      if (file.buffer.length < 8) {
        return { valid: false, error: 'File signature mismatch: File claims to be legacy Office document (.doc/.xls) but binary header is truncated.' };
      }
      const oleMagic = file.buffer.subarray(0, 8);
      const isOle2 =
        oleMagic[0] === 0xD0 &&
        oleMagic[1] === 0xCF &&
        oleMagic[2] === 0x11 &&
        oleMagic[3] === 0xE0 &&
        oleMagic[4] === 0xA1 &&
        oleMagic[5] === 0xB1 &&
        oleMagic[6] === 0x1A &&
        oleMagic[7] === 0xE1;
      if (!isOle2) {
        return { valid: false, error: 'File signature mismatch: File claims to be legacy Office document (.doc/.xls) but binary header is invalid.' };
      }
    }
  }

  return { valid: true };
}

export function sanitizeFilename(filename: string): string {
  // Strip path traversal sequences, null bytes, backslashes, control characters
  return path.basename(filename)
    .replace(/[\0\r\n\t]/g, '')
    .replace(/[^a-zA-Z0-9._\-\s]/g, '_')
    .substring(0, 255);
}

/**
 * 5. Centralized Error Handler (No sensitive info leakage)
 */
export function errorHandler(err: any, req: Request, res: Response, next: NextFunction) {
  const isProduction = process.env.NODE_ENV === 'production';
  const timestamp = new Date().toISOString();

  // Log error safely without dumping raw tokens or body credentials
  console.error(`[${timestamp}] [ERROR] ${req.method} ${req.originalUrl}:`, err?.message || err);

  // If CORS error
  if (err?.message && err.message.includes('CORS policy violation')) {
    return res.status(403).json({ error: err.message, code: 'CORS_FORBIDDEN' });
  }

  // If headers already sent
  if (res.headersSent) {
    return next(err);
  }

  const statusCode = err.status || err.statusCode || 500;
  const message = isProduction && statusCode === 500
    ? 'An unexpected internal error occurred. Please contact system support.'
    : err.message || 'Internal Server Error';

  return res.status(statusCode).json({
    error: message,
    code: err.code || 'SERVER_ERROR',
    ...(isProduction ? {} : { stack: err.stack }),
  });
}
