import { Router, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { AuthenticatedRequest, authenticate } from '../auth';
import db from '../db';

const router = Router();

const uploadsDir = path.resolve(__dirname, '../../../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const basename = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${basename}-${uniqueSuffix}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB max
});

router.post('/', authenticate, upload.single('file'), async (req: AuthenticatedRequest, res: Response) => {
  const file = req.file;
  if (!file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const user = req.user!;
  const now = new Date().toISOString();
  const fileUrl = `/api/files/${file.filename}`;

  // Track upload in file_uploads staging table
  try {
    await db.prepare(`
      INSERT INTO file_uploads (filename, original_filename, mime_type, file_size, uploaded_by_id, uploaded_by_name, uploaded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (filename) DO UPDATE SET
        original_filename = EXCLUDED.original_filename,
        mime_type = EXCLUDED.mime_type,
        file_size = EXCLUDED.file_size,
        uploaded_by_id = EXCLUDED.uploaded_by_id,
        uploaded_by_name = EXCLUDED.uploaded_by_name,
        uploaded_at = EXCLUDED.uploaded_at
    `).run(
      file.filename,
      file.originalname,
      file.mimetype,
      file.size,
      user.id,
      user.full_name,
      now
    );
  } catch (err) {
    console.warn('Note: file_uploads tracking entry error:', err);
  }

  return res.json({
    file_url: fileUrl,
    file_name: file.originalname,
    file_size: file.size,
    file_type: file.mimetype,
    uploaded_by: user.full_name,
    uploaded_date: now,
  });
});

export default router;
