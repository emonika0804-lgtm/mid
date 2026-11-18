import { Router, Response } from 'express';
import multer from 'multer';
import { AuthenticatedRequest, authenticate } from '../auth';
import { saveUploadedFile } from '../attachmentService';
import { uploadRateLimiter, validateUploadedFile, sanitizeFilename } from '../security';

const router = Router();

// Store files directly in memory buffer for PostgreSQL BYTEA persistence (zero disk dependency)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024, // 25MB max
    files: 1,
  },
});

router.post('/', uploadRateLimiter, authenticate, (req: AuthenticatedRequest, res: Response, next) => {
  upload.single('file')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'Upload rejected: File size exceeds the maximum limit of 25MB.' });
      }
      return res.status(400).json({ error: `Upload error: ${err.message}` });
    } else if (err) {
      return res.status(400).json({ error: `Upload error: ${err.message}` });
    }
    next();
  });
}, async (req: AuthenticatedRequest, res: Response) => {
  const file = req.file;
  if (!file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  // 1. File type, extension, and binary header validation
  const validation = validateUploadedFile(file);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.error });
  }

  // 2. Filename sanitization
  const cleanOriginalName = sanitizeFilename(file.originalname);

  const user = req.user!;

  try {
    const saved = await saveUploadedFile({
      originalname: cleanOriginalName,
      mimetype: file.mimetype,
      buffer: file.buffer,
      user,
      claimId: req.body.claim_id,
      surveyId: req.body.survey_id,
      mandatoryType: req.body.mandatory_attachment_type || req.body.type,
    });

    return res.json({
      file_url: saved.file_url,
      file_name: saved.file_name,
      file_size: saved.file_size,
      file_type: saved.file_type,
      uploaded_by: saved.uploaded_by,
      uploaded_date: saved.uploaded_date,
      attachment_id: saved.id,
      checksum: saved.checksum,
    });
  } catch (err: any) {
    console.error('File upload error:', err);
    return res.status(500).json({ error: 'Failed to securely store document in database.' });
  }
});

export default router;
