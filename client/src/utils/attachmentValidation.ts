import {
  MANDATORY_DOCS_DRY_CLAIM,
  MANDATORY_DOCS_REEFER_CLAIM,
  MANDATORY_DOCS_DRY_SURVEY,
  MANDATORY_DOCS_REEFER_SURVEY,
} from '../constants/referenceData';

export {
  MANDATORY_DOCS_DRY_CLAIM,
  MANDATORY_DOCS_REEFER_CLAIM,
  MANDATORY_DOCS_DRY_SURVEY,
  MANDATORY_DOCS_REEFER_SURVEY,
};

/**
 * Normalizes document titles for robust comparison:
 * Lowercases, strips '(as applicable)' suffix, and removes all non-alphanumeric characters.
 */
export function normalizeDocTitle(title: string): string {
  return (title || '')
    .toLowerCase()
    .replace(/\s*\(?as applicable\)?\s*/gi, '')
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Matches document titles consistently:
 * - Exact string match
 * - Case-insensitive trimmed match
 * - Normalized match (ignoring punctuation, spacing, and '(As applicable)')
 */
export function isDocMatching(titleA: string, titleB: string): boolean {
  if (!titleA || !titleB) return false;
  if (titleA === titleB) return true;
  const a = titleA.trim().toLowerCase();
  const b = titleB.trim().toLowerCase();
  if (a === b) return true;
  const normA = normalizeDocTitle(a);
  const normB = normalizeDocTitle(b);
  return normA.length > 0 && normA === normB;
}

/**
 * Verifies whether an attachment record has a genuine, valid stored file reference.
 * An attachment is NOT valid merely because filename exists; it must have a non-empty
 * file_url, attachment_id, or stored_filename.
 */
export function hasValidUpload(att: any): boolean {
  if (!att) return false;
  const hasUrl = typeof att.file_url === 'string' && att.file_url.trim().length > 0;
  const hasAttId = typeof att.attachment_id === 'string' && att.attachment_id.trim().length > 0;
  const hasStoredFilename = typeof att.stored_filename === 'string' && att.stored_filename.trim().length > 0;
  return Boolean(hasUrl || hasAttId || hasStoredFilename);
}

/**
 * Verifies whether a non-empty, non-whitespace missing-document reason is provided.
 * Empty strings and whitespace-only strings (e.g. "   ") are strictly treated as empty.
 */
export function hasValidReason(att: any): boolean {
  if (!att) return false;
  return typeof att.comment === 'string' && att.comment.trim().length > 0;
}

/**
 * Universal Mandatory Attachments Validation for Claims.
 * Evaluates the actual current state of all attachments:
 * - Condition A: Valid uploaded file exists
 * - OR Condition B: Meaningful, non-empty missing-document reason exists
 * If both are absent, the document is incomplete.
 */
export function validateClaimMandatoryAttachments(
  attachments: any[],
  cargoType: string = 'dry'
): { valid: boolean; missing: string[] } {
  const isReefer = (cargoType || '').toLowerCase() === 'reefer';
  const docList = isReefer ? MANDATORY_DOCS_REEFER_CLAIM : MANDATORY_DOCS_DRY_CLAIM;
  const missing: string[] = [];
  const safeAttachments = Array.isArray(attachments) ? attachments : [];

  for (const doc of docList) {
    const matching = safeAttachments.filter((a: any) => {
      const aType = a?.type || a?.mandatory_attachment_type || '';
      return isDocMatching(aType, doc);
    });

    if (matching.length === 0) {
      missing.push(doc);
      continue;
    }

    const isUploaded = matching.some((a: any) => hasValidUpload(a));
    const hasReason = matching.some((a: any) => hasValidReason(a));

    if (!isUploaded && !hasReason) {
      missing.push(doc);
    }
  }

  return {
    valid: missing.length === 0,
    missing,
  };
}

/**
 * Universal Mandatory Attachments Validation for Surveys.
 * Evaluates the actual current state of all attachments:
 * - Condition A: Valid uploaded file exists
 * - OR Condition B: Meaningful, non-empty missing-document reason exists
 * If both are absent, the document is incomplete.
 */
export function validateSurveyMandatoryAttachments(
  attachments: any[],
  cargoType: string = 'dry'
): { valid: boolean; missing: string[] } {
  const isReefer = (cargoType || '').toLowerCase() === 'reefer';
  const docList = isReefer ? MANDATORY_DOCS_REEFER_SURVEY : MANDATORY_DOCS_DRY_SURVEY;
  const missing: string[] = [];
  const safeAttachments = Array.isArray(attachments) ? attachments : [];

  for (const doc of docList) {
    const matching = safeAttachments.filter((a: any) => {
      const aType = a?.type || a?.mandatory_attachment_type || '';
      return isDocMatching(aType, doc);
    });

    if (matching.length === 0) {
      missing.push(doc);
      continue;
    }

    const isUploaded = matching.some((a: any) => hasValidUpload(a));
    const hasReason = matching.some((a: any) => hasValidReason(a));

    if (!isUploaded && !hasReason) {
      missing.push(doc);
    }
  }

  return {
    valid: missing.length === 0,
    missing,
  };
}
