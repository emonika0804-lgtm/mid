import { Router, Request, Response, NextFunction } from 'express';
import path from 'path';
import jwt from 'jsonwebtoken';
import db from '../db';
import { JWT_SECRET, AuthUser } from '../auth';
import {
  getAttachmentMetadata,
  getAttachmentBinary,
  isUserAuthorizedForAttachment,
  getMimeTypeFromFilename,
} from '../attachmentService';

const router = Router();

interface AuthenticatedFileRequest extends Request {
  user?: AuthUser;
}

/**
 * Middleware: Verify JWT and active account status for file requests.
 * Accepts authentication strictly through the Authorization header (Bearer token).
 * URL query parameter authentication is explicitly rejected for security.
 */
async function authenticateFileRequest(req: AuthenticatedFileRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'Authentication required. Document access is restricted to authenticated sessions with a Bearer token in the Authorization header.',
    });
  }

  const token = authHeader.split(' ')[1];
  if (!token || !token.trim()) {
    return res.status(401).json({
      error: 'Authentication token is required.',
    });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as AuthUser;

    // Verify active account status in the database
    const user = (await db.prepare('SELECT id, email, full_name, role, is_verified FROM users WHERE id = ?').get(decoded.id)) as
      | (AuthUser & { is_verified: number })
      | undefined;

    if (!user) {
      return res.status(401).json({ error: 'User account not found or has been revoked.' });
    }

    if (!user.is_verified) {
      return res.status(403).json({ error: 'Account not verified. Access to confidential documents is restricted.' });
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired authentication token.' });
  }
}

/**
 * Helper to serve binary attachment from PostgreSQL BYTEA
 */
async function serveAttachment(
  req: AuthenticatedFileRequest,
  res: Response,
  identifier: string,
  forceDownload?: boolean
) {
  const user = req.user!;

  // 1. Path traversal prevention & filename sanitization
  if (
    !identifier ||
    identifier.includes('..') ||
    identifier.includes('/') ||
    identifier.includes('\\') ||
    identifier.includes('\0')
  ) {
    return res.status(400).json({ error: 'Invalid filename or illegal traversal attempt.' });
  }

  const filename = path.basename(identifier);
  if (filename !== identifier) {
    return res.status(400).json({ error: 'Invalid filename formatting.' });
  }

  // 2. Lookup document metadata in PostgreSQL attachment_metadata
  const meta = await getAttachmentMetadata(identifier);

  if (!meta) {
    return res.status(404).json({
      error: 'Requested document not found on storage.',
    });
  }

  // 3. Role-based and record-level authorization evaluation
  const isAuthorized = await isUserAuthorizedForAttachment(meta, user);
  if (!isAuthorized) {
    return res.status(403).json({
      error: 'Access denied: You do not have permission to view documents for this record.',
    });
  }

  // 4. Retrieve binary content directly from PostgreSQL BYTEA
  const binaryData = await getAttachmentBinary(meta.id);
  if (!binaryData) {
    return res.status(404).json({
      error: 'Document binary content not found in database.',
    });
  }

  // 5. Send binary with secure response headers
  const contentType = meta.mime_type || getMimeTypeFromFilename(meta.original_filename || filename);
  const originalFilename = meta.original_filename || filename;

  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Length', binaryData.length);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');

  // Preview (inline) vs Download (attachment)
  const isDownload = forceDownload !== undefined ? forceDownload : req.query.download === '1';
  const disposition = isDownload ? 'attachment' : 'inline';
  res.setHeader('Content-Disposition', `${disposition}; filename="${encodeURIComponent(originalFilename)}"`);

  return res.end(binaryData);
}

// Subroute for explicit download: GET /api/files/:id/download
router.get('/:id/download', authenticateFileRequest, async (req: AuthenticatedFileRequest, res: Response) => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  return serveAttachment(req, res, rawId, true);
});

// Subroute for explicit preview: GET /api/files/:id/preview
router.get('/:id/preview', authenticateFileRequest, async (req: AuthenticatedFileRequest, res: Response) => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  return serveAttachment(req, res, rawId, false);
});

/**
 * GET /:filename
 * Secure document retrieval directly from PostgreSQL BYTEA storage.
 * Enforces path traversal prevention, metadata lookup, RLS authorization,
 * and authenticated binary delivery. Zero disk dependency.
 */
router.get('/:filename', authenticateFileRequest, async (req: AuthenticatedFileRequest, res: Response) => {
  const rawParam = req.params.filename;
  const rawFilename = Array.isArray(rawParam) ? rawParam[0] : rawParam;
  return serveAttachment(req, res, rawFilename);
});

export default router;
