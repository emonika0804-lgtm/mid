import { Router, Response } from 'express';
import { AuthenticatedRequest, authenticate } from '../auth';
import {
  searchAttachments,
  getDocumentTypes,
  getAttachmentMetadata,
  isUserAuthorizedForAttachment,
} from '../attachmentService';

const router = Router();

/**
 * GET /api/attachments/search
 * Secure document search and filtering with RLS agency isolation,
 * multi-criteria filters, pagination, and sorting.
 */
router.get('/search', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  try {
    const results = await searchAttachments(
      {
        query: req.query.query as string,
        bl_number: req.query.bl_number as string,
        claim_number: req.query.claim_number as string,
        survey_number: req.query.survey_number as string,
        cms_number: (req.query.cms_number || req.query.cms_reference_number) as string,
        document_type: (req.query.document_type || req.query.type) as string,
        filename: req.query.filename as string,
        uploaded_by: req.query.uploaded_by as string,
        from_date: req.query.from_date as string,
        to_date: req.query.to_date as string,
        page: req.query.page ? parseInt(req.query.page as string, 10) : 1,
        limit: req.query.limit ? parseInt(req.query.limit as string, 10) : 10,
        sort_by: req.query.sort_by as string,
        sort_order: (req.query.sort_order as 'ASC' | 'DESC') || 'DESC',
      },
      user
    );

    return res.json(results);
  } catch (err: any) {
    console.error('Document search error:', err);
    return res.status(500).json({ error: 'Failed to search documents.' });
  }
});

/**
 * GET /api/attachments/types
 * Distinct document types for filter dropdowns (RLS scoped).
 */
router.get('/types', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  try {
    const types = await getDocumentTypes(user);
    return res.json(types);
  } catch (err: any) {
    console.error('Document types fetch error:', err);
    return res.status(500).json({ error: 'Failed to fetch document types.' });
  }
});

/**
 * GET /api/attachments/:id
 * Retrieve metadata for a single document with permission check.
 */
router.get('/:id', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  try {
    const meta = await getAttachmentMetadata(id);
    if (!meta) {
      return res.status(404).json({ error: 'Document not found.' });
    }

    const authorized = await isUserAuthorizedForAttachment(meta, user);
    if (!authorized) {
      return res.status(403).json({ error: 'Access denied: You do not have permission to view this document.' });
    }

    return res.json({
      ...meta,
      file_url: `/api/files/${meta.stored_filename}`,
    });
  } catch (err: any) {
    console.error('Attachment metadata error:', err);
    return res.status(500).json({ error: 'Failed to fetch document metadata.' });
  }
});

export default router;
