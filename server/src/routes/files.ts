import { Router, Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import jwt from 'jsonwebtoken';
import db from '../db';
import { JWT_SECRET, AuthUser } from '../auth';

const router = Router();

// Uploads directory path
const uploadsDir = path.resolve(__dirname, '../../../uploads');

// Map common extensions to MIME types
const MIME_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.csv': 'text/csv',
  '.txt': 'text/plain',
  '.zip': 'application/zip',
};

interface AuthenticatedFileRequest extends Request {
  user?: AuthUser;
}

/**
 * Middleware: Verify JWT and active account status for file requests.
 * Accepts authentication strictly through the Authorization header (Bearer token).
 * URL query parameter authentication is explicitly disabled for security.
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
 * GET /:filename
 * Secure file serving endpoint with path traversal protection,
 * database record lookup, and role/record-level authorization.
 */
router.get('/:filename', authenticateFileRequest, async (req: AuthenticatedFileRequest, res: Response) => {
  const rawParam = req.params.filename;
  const rawFilename = Array.isArray(rawParam) ? rawParam[0] : rawParam;
  const user = req.user!;

  // 1. Path traversal prevention & filename sanitization
  if (
    !rawFilename ||
    rawFilename.includes('..') ||
    rawFilename.includes('/') ||
    rawFilename.includes('\\') ||
    rawFilename.includes('\0')
  ) {
    return res.status(400).json({ error: 'Invalid filename or illegal traversal attempt.' });
  }

  const filename = path.basename(rawFilename);
  if (filename !== rawFilename) {
    return res.status(400).json({ error: 'Invalid filename formatting.' });
  }

  const filePath = path.resolve(uploadsDir, filename);

  // Ensure resolved path remains strictly within uploadsDir
  if (!filePath.startsWith(uploadsDir)) {
    return res.status(400).json({ error: 'Illegal file path resolution.' });
  }

  // Check physical file existence on disk
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Requested document not found on storage.' });
  }

  // 2. Secure filename-to-record lookup
  // A file must be associated with a valid Claim, Survey, or verified upload staging record.
  const matchedClaims = (await db
    .prepare(
      `SELECT id, claim_number, created_by_id, attachments, email_thread, court_case_file_attachment
       FROM claims
       WHERE attachments LIKE ? OR email_thread LIKE ? OR court_case_file_attachment LIKE ?`
    )
    .all(`%${filename}%`, `%${filename}%`, `%${filename}%`)) as any[];

  const matchedSurveys = (await db
    .prepare(
      `SELECT id, survey_number, created_by_id, attachments
       FROM surveys
       WHERE attachments LIKE ?`
    )
    .all(`%${filename}%`)) as any[];

  const uploadRecord = (await db
    .prepare(`SELECT * FROM file_uploads WHERE filename = ?`)
    .get(filename)) as any;

  // If the file is not referenced in any Claim, Survey, or file upload record, deny access
  if (matchedClaims.length === 0 && matchedSurveys.length === 0 && !uploadRecord) {
    return res.status(404).json({
      error: 'Document is not linked to any active Claim, Survey, or verified upload record.',
    });
  }

  // 3. Role-based and record-level authorization evaluation
  const privilegedRoles = ['admin', 'mid', 'mid_gcc'];
  const isPrivileged = privilegedRoles.includes(user.role);

  if (!isPrivileged) {
    const isAttachedToRecord = matchedClaims.length > 0 || matchedSurveys.length > 0;
    let isAuthorized = false;

    if (isAttachedToRecord) {
      // If the document is attached to one or more Claims or Surveys,
      // the Agency/Employee user MUST be authorized to view at least one of those records.
      // They CANNOT access it even if they originally uploaded it if they do not own the record.
      for (const claim of matchedClaims) {
        if (claim.created_by_id === user.id) {
          isAuthorized = true;
          break;
        }
      }

      if (!isAuthorized) {
        for (const survey of matchedSurveys) {
          if (survey.created_by_id === user.id) {
            isAuthorized = true;
            break;
          }
        }
      }
    } else {
      // If the document is NOT attached to any Claim or Survey (unlinked draft/staging upload),
      // preserve legitimate access ONLY for the original uploader.
      if (uploadRecord && uploadRecord.uploaded_by_id === user.id) {
        isAuthorized = true;
      }
    }

    if (!isAuthorized) {
      return res.status(403).json({
        error: 'Access denied: You do not have permission to view documents for this record.',
      });
    }
  }

  // 4. Secure file streaming with appropriate headers
  const ext = path.extname(filename).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  const originalFilename = uploadRecord?.original_filename || filename;

  res.setHeader('Content-Type', contentType);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');

  // If download query param requested, set attachment disposition
  const disposition = req.query.download === '1' ? 'attachment' : 'inline';
  res.setHeader('Content-Disposition', `${disposition}; filename="${encodeURIComponent(originalFilename)}"`);

  const fileStream = fs.createReadStream(filePath);
  fileStream.on('error', (err) => {
    console.error('File stream error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to stream document content.' });
    }
  });

  return fileStream.pipe(res);
});

export default router;
