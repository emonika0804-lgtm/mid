import crypto from 'crypto';
import path from 'path';
import { pool } from './pgdb';
import { AuthUser } from './auth';

export interface StoredAttachment {
  id: string;
  claim_id?: string | null;
  survey_id?: string | null;
  bl_number?: string | null;
  cms_reference_number?: string | null;
  claim_number?: string | null;
  survey_number?: string | null;
  mandatory_attachment_type?: string | null;
  original_filename: string;
  stored_filename: string;
  mime_type: string;
  file_size: number;
  uploaded_by_id?: string | null;
  uploaded_by_name?: string | null;
  uploaded_at: string;
  comments?: string | null;
  document_status?: string | null;
  checksum?: string | null;
  created_date: string;
}

const MIME_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.csv': 'text/csv',
  '.txt': 'text/plain',
  '.zip': 'application/zip',
  '.lnk': 'application/x-ms-shortcut',
};

export function getMimeTypeFromFilename(filename: string, fallback = 'application/octet-stream'): string {
  const ext = path.extname(filename).toLowerCase();
  return MIME_MAP[ext] || fallback;
}

/**
 * Save newly uploaded document buffer directly into PostgreSQL BYTEA
 */
export async function saveUploadedFile(params: {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
  user: AuthUser;
  claimId?: string;
  surveyId?: string;
  mandatoryType?: string;
}): Promise<{
  id: string;
  stored_filename: string;
  file_url: string;
  file_name: string;
  file_size: number;
  file_type: string;
  uploaded_by: string;
  uploaded_date: string;
  checksum: string;
}> {
  const { originalname, mimetype, buffer, user, claimId, surveyId, mandatoryType } = params;

  // Sanitize filename
  const ext = path.extname(originalname);
  const basename = path.basename(originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
  const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  const storedFilename = `${basename}-${uniqueSuffix}${ext}`;
  const attachmentId = `att-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  const checksum = crypto.createHash('sha256').update(buffer).digest('hex');
  const now = new Date().toISOString();
  const resolvedMime = mimetype && mimetype !== 'application/octet-stream' ? mimetype : getMimeTypeFromFilename(originalname);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Insert into attachment_metadata
    await client.query(
      `INSERT INTO attachment_metadata (
        id, claim_id, survey_id, bl_number, cms_reference_number,
        claim_number, survey_number, mandatory_attachment_type,
        original_filename, stored_filename, mime_type, file_size,
        uploaded_by_id, uploaded_by_name, uploaded_at, comments,
        document_status, checksum, created_date
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8,
        $9, $10, $11, $12,
        $13, $14, $15, $16,
        $17, $18, $19
      )`,
      [
        attachmentId,
        claimId || null,
        surveyId || null,
        null,
        null,
        null,
        null,
        mandatoryType || null,
        originalname,
        storedFilename,
        resolvedMime,
        buffer.length,
        user.id,
        user.full_name,
        now,
        null,
        'uploaded',
        checksum,
        now,
      ]
    );

    // 2. Insert binary data into attachment_contents
    await client.query(
      `INSERT INTO attachment_contents (attachment_id, file_data)
       VALUES ($1, $2)`,
      [attachmentId, buffer]
    );

    // 3. Keep file_uploads staging table in sync for compatibility
    await client.query(
      `INSERT INTO file_uploads (filename, original_filename, mime_type, file_size, uploaded_by_id, uploaded_by_name, uploaded_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (filename) DO UPDATE SET
        original_filename = EXCLUDED.original_filename,
        mime_type = EXCLUDED.mime_type,
        file_size = EXCLUDED.file_size,
        uploaded_by_id = EXCLUDED.uploaded_by_id,
        uploaded_by_name = EXCLUDED.uploaded_by_name,
        uploaded_at = EXCLUDED.uploaded_at`,
      [storedFilename, originalname, resolvedMime, buffer.length, user.id, user.full_name, now]
    );

    await client.query('COMMIT');

    return {
      id: attachmentId,
      stored_filename: storedFilename,
      file_url: `/api/files/${storedFilename}`,
      file_name: originalname,
      file_size: buffer.length,
      file_type: resolvedMime,
      uploaded_by: user.full_name,
      uploaded_date: now,
      checksum,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Get attachment metadata by stored filename or attachment ID
 */
export async function getAttachmentMetadata(identifier: string): Promise<StoredAttachment | null> {
  const res = await pool.query(
    `SELECT * FROM attachment_metadata WHERE stored_filename = $1 OR id = $1 LIMIT 1`,
    [identifier]
  );
  if (res.rows.length === 0) return null;
  return res.rows[0] as StoredAttachment;
}

/**
 * Get attachment binary content (BYTEA) directly from PostgreSQL
 */
export async function getAttachmentBinary(attachmentId: string): Promise<Buffer | null> {
  const res = await pool.query(
    `SELECT file_data FROM attachment_contents WHERE attachment_id = $1 LIMIT 1`,
    [attachmentId]
  );
  if (res.rows.length === 0 || !res.rows[0].file_data) return null;
  return res.rows[0].file_data as Buffer;
}

/**
 * Synchronize Claim attachments to attachment_metadata
 */
export async function syncClaimAttachments(
  claimId: string,
  claimNumber: string,
  blNumber: string,
  cmsNumber: string | null,
  attachments: any[],
  userId?: string,
  userName?: string
): Promise<void> {
  if (!Array.isArray(attachments) || attachments.length === 0) return;

  for (const att of attachments) {
    if (att && att.file_url) {
      const filename = path.basename(att.file_url);
      await pool.query(
        `UPDATE attachment_metadata SET
          claim_id = $1,
          claim_number = $2,
          bl_number = $3,
          cms_reference_number = $4,
          mandatory_attachment_type = COALESCE($5, mandatory_attachment_type),
          comments = COALESCE($6, comments),
          original_filename = COALESCE($7, original_filename)
        WHERE stored_filename = $8 OR id = $8`,
        [
          claimId,
          claimNumber,
          blNumber,
          cmsNumber,
          att.type || null,
          att.comment || null,
          att.file_name || null,
          filename,
        ]
      );
    }
  }
}

/**
 * Synchronize Survey attachments to attachment_metadata
 */
export async function syncSurveyAttachments(
  surveyId: string,
  surveyNumber: string,
  blNumber: string,
  cmsNumber: string | null,
  attachments: any[],
  userId?: string,
  userName?: string
): Promise<void> {
  if (!Array.isArray(attachments) || attachments.length === 0) return;

  for (const att of attachments) {
    if (att && att.file_url) {
      const filename = path.basename(att.file_url);
      await pool.query(
        `UPDATE attachment_metadata SET
          survey_id = $1,
          survey_number = $2,
          bl_number = $3,
          cms_reference_number = $4,
          mandatory_attachment_type = COALESCE($5, mandatory_attachment_type),
          comments = COALESCE($6, comments),
          original_filename = COALESCE($7, original_filename)
        WHERE stored_filename = $8 OR id = $8`,
        [
          surveyId,
          surveyNumber,
          blNumber,
          cmsNumber,
          att.type || null,
          att.comment || null,
          att.file_name || null,
          filename,
        ]
      );
    }
  }
}

/**
 * Check if an authenticated user is authorized to view/download an attachment
 */
export async function isUserAuthorizedForAttachment(
  meta: StoredAttachment,
  user: AuthUser
): Promise<boolean> {
  const privilegedRoles = ['admin', 'mid', 'mid_gcc'];
  if (privilegedRoles.includes(user.role)) {
    return true;
  }

  // Check direct claim ownership
  if (meta.claim_id) {
    const claimRes = await pool.query('SELECT created_by_id FROM claims WHERE id = $1', [meta.claim_id]);
    if (claimRes.rows.length > 0 && claimRes.rows[0].created_by_id === user.id) {
      return true;
    }
  }

  // Check direct survey ownership
  if (meta.survey_id) {
    const surveyRes = await pool.query('SELECT created_by_id FROM surveys WHERE id = $1', [meta.survey_id]);
    if (surveyRes.rows.length > 0 && surveyRes.rows[0].created_by_id === user.id) {
      return true;
    }
  }

  // Check if filename appears in claims or surveys owned by the user
  const fn = meta.stored_filename;
  if (fn) {
    const matchedClaims = await pool.query(
      `SELECT id, created_by_id FROM claims
       WHERE (attachments LIKE $1 OR email_thread LIKE $1 OR court_case_file_attachment LIKE $1)
       AND created_by_id = $2`,
      [`%${fn}%`, user.id]
    );
    if (matchedClaims.rows.length > 0) return true;

    const matchedSurveys = await pool.query(
      `SELECT id, created_by_id FROM surveys
       WHERE (attachments LIKE $1 OR mail_thread_attachments LIKE $1)
       AND created_by_id = $2`,
      [`%${fn}%`, user.id]
    );
    if (matchedSurveys.rows.length > 0) return true;
  }

  // If not attached to any claim or survey (staging/draft upload), check if original uploader
  if (!meta.claim_id && !meta.survey_id) {
    if (meta.uploaded_by_id === user.id) {
      return true;
    }
    // Also check file_uploads staging table
    const fu = await pool.query('SELECT uploaded_by_id FROM file_uploads WHERE filename = $1', [meta.stored_filename]);
    if (fu.rows.length > 0 && fu.rows[0].uploaded_by_id === user.id) {
      return true;
    }
  }

  return false;
}

export interface DocumentSearchParams {
  query?: string;
  bl_number?: string;
  claim_number?: string;
  survey_number?: string;
  cms_number?: string;
  document_type?: string;
  filename?: string;
  uploaded_by?: string;
  from_date?: string;
  to_date?: string;
  page?: number;
  limit?: number;
  sort_by?: string;
  sort_order?: 'ASC' | 'DESC';
}

export interface DocumentSearchResult {
  documents: Array<StoredAttachment & { file_url: string }>;
  pagination: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
  };
}

/**
 * Search and filter documents with strict Role-Based Access Control and pagination.
 * Binary BYTEA content is intentionally EXCLUDED from this query for high performance.
 */
export async function searchAttachments(
  params: DocumentSearchParams,
  user: AuthUser
): Promise<DocumentSearchResult> {
  const page = Math.max(1, parseInt(String(params.page || 1), 10));
  const limit = Math.min(100, Math.max(1, parseInt(String(params.limit || 10), 10)));
  const offset = (page - 1) * limit;

  const conditions: string[] = [];
  const values: any[] = [];
  let paramIdx = 1;

  // 1. Role-Based Access Control & Agency Isolation
  const privilegedRoles = ['admin', 'mid', 'mid_gcc'];
  if (!privilegedRoles.includes(user.role)) {
    // Agency users only see documents they own or uploaded
    conditions.push(`(
      am.claim_id IN (SELECT id FROM claims WHERE created_by_id = $${paramIdx})
      OR am.survey_id IN (SELECT id FROM surveys WHERE created_by_id = $${paramIdx})
      OR (am.claim_id IS NULL AND am.survey_id IS NULL AND am.uploaded_by_id = $${paramIdx})
      OR EXISTS (
        SELECT 1 FROM claims c
        WHERE c.created_by_id = $${paramIdx}
        AND (c.attachments LIKE '%' || am.stored_filename || '%'
             OR c.email_thread LIKE '%' || am.stored_filename || '%'
             OR c.court_case_file_attachment LIKE '%' || am.stored_filename || '%')
      )
      OR EXISTS (
        SELECT 1 FROM surveys s
        WHERE s.created_by_id = $${paramIdx}
        AND (s.attachments LIKE '%' || am.stored_filename || '%'
             OR s.mail_thread_attachments LIKE '%' || am.stored_filename || '%')
      )
    )`);
    values.push(user.id);
    paramIdx++;
  }

  // 2. Multi-field Search Query
  if (params.query && params.query.trim()) {
    const q = `%${params.query.trim()}%`;
    conditions.push(`(
      am.bl_number ILIKE $${paramIdx}
      OR am.claim_number ILIKE $${paramIdx}
      OR am.survey_number ILIKE $${paramIdx}
      OR am.cms_reference_number ILIKE $${paramIdx}
      OR am.original_filename ILIKE $${paramIdx}
      OR am.mandatory_attachment_type ILIKE $${paramIdx}
      OR am.uploaded_by_name ILIKE $${paramIdx}
    )`);
    values.push(q);
    paramIdx++;
  }

  // 3. Specific Field Filters
  if (params.bl_number && params.bl_number.trim()) {
    conditions.push(`am.bl_number ILIKE $${paramIdx}`);
    values.push(`%${params.bl_number.trim()}%`);
    paramIdx++;
  }

  if (params.claim_number && params.claim_number.trim()) {
    conditions.push(`am.claim_number ILIKE $${paramIdx}`);
    values.push(`%${params.claim_number.trim()}%`);
    paramIdx++;
  }

  if (params.survey_number && params.survey_number.trim()) {
    conditions.push(`am.survey_number ILIKE $${paramIdx}`);
    values.push(`%${params.survey_number.trim()}%`);
    paramIdx++;
  }

  if (params.cms_number && params.cms_number.trim()) {
    conditions.push(`am.cms_reference_number ILIKE $${paramIdx}`);
    values.push(`%${params.cms_number.trim()}%`);
    paramIdx++;
  }

  if (params.document_type && params.document_type.trim() && params.document_type !== 'all') {
    conditions.push(`am.mandatory_attachment_type ILIKE $${paramIdx}`);
    values.push(`%${params.document_type.trim()}%`);
    paramIdx++;
  }

  if (params.filename && params.filename.trim()) {
    conditions.push(`am.original_filename ILIKE $${paramIdx}`);
    values.push(`%${params.filename.trim()}%`);
    paramIdx++;
  }

  if (params.uploaded_by && params.uploaded_by.trim()) {
    conditions.push(`(am.uploaded_by_name ILIKE $${paramIdx} OR am.uploaded_by_id = $${paramIdx})`);
    values.push(`%${params.uploaded_by.trim()}%`);
    paramIdx++;
  }

  if (params.from_date && params.from_date.trim()) {
    conditions.push(`am.uploaded_at >= $${paramIdx}`);
    values.push(params.from_date.trim());
    paramIdx++;
  }

  if (params.to_date && params.to_date.trim()) {
    conditions.push(`am.uploaded_at <= $${paramIdx}`);
    // End of day if date only
    const toVal = params.to_date.trim().length === 10 ? `${params.to_date.trim()}T23:59:59.999Z` : params.to_date.trim();
    values.push(toVal);
    paramIdx++;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // 4. Sorting validation
  const ALLOWED_SORTS: Record<string, string> = {
    uploaded_at: 'am.uploaded_at',
    original_filename: 'am.original_filename',
    file_size: 'am.file_size',
    claim_number: 'am.claim_number',
    survey_number: 'am.survey_number',
    bl_number: 'am.bl_number',
    mandatory_attachment_type: 'am.mandatory_attachment_type',
  };

  const sortCol = ALLOWED_SORTS[params.sort_by || 'uploaded_at'] || 'am.uploaded_at';
  const sortDir = (params.sort_order || 'DESC').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

  // 5. Total count query
  const countSql = `SELECT COUNT(*) as total FROM attachment_metadata am ${whereClause}`;
  const countRes = await pool.query(countSql, values);
  const total = parseInt(countRes.rows[0]?.total || '0', 10);
  const totalPages = Math.ceil(total / limit) || 1;

  // 6. Data query (excluding file_data BYTEA)
  const dataSql = `
    SELECT
      am.id,
      am.claim_id,
      am.survey_id,
      am.bl_number,
      am.cms_reference_number,
      am.claim_number,
      am.survey_number,
      am.mandatory_attachment_type,
      am.original_filename,
      am.stored_filename,
      am.mime_type,
      am.file_size,
      am.uploaded_by_id,
      am.uploaded_by_name,
      am.uploaded_at,
      am.comments,
      am.document_status,
      am.checksum,
      am.created_date
    FROM attachment_metadata am
    ${whereClause}
    ORDER BY ${sortCol} ${sortDir} NULLS LAST
    LIMIT $${paramIdx++} OFFSET $${paramIdx++}
  `;

  const dataValues = [...values, limit, offset];
  const dataRes = await pool.query(dataSql, dataValues);

  const documents = dataRes.rows.map((row) => ({
    ...row,
    file_url: `/api/files/${row.stored_filename}`,
  }));

  return {
    documents,
    pagination: {
      page,
      limit,
      total,
      total_pages: totalPages,
    },
  };
}

/**
 * Get distinct document types for filter dropdowns based on user permissions
 */
export async function getDocumentTypes(user: AuthUser): Promise<string[]> {
  const privilegedRoles = ['admin', 'mid', 'mid_gcc'];
  let sql = `
    SELECT DISTINCT mandatory_attachment_type
    FROM attachment_metadata
    WHERE mandatory_attachment_type IS NOT NULL AND mandatory_attachment_type != ''
  `;
  const params: any[] = [];

  if (!privilegedRoles.includes(user.role)) {
    sql += ` AND (
      claim_id IN (SELECT id FROM claims WHERE created_by_id = $1)
      OR survey_id IN (SELECT id FROM surveys WHERE created_by_id = $1)
      OR (claim_id IS NULL AND survey_id IS NULL AND uploaded_by_id = $1)
    )`;
    params.push(user.id);
  }

  sql += ' ORDER BY mandatory_attachment_type ASC';
  const res = await pool.query(sql, params);
  return res.rows.map(r => r.mandatory_attachment_type);
}
