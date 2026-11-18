import { requestApi, TestItem, BASE_URL } from './testApp';
import crypto from 'crypto';
import db from '../server/src/db';
import { MANDATORY_DOCS_DRY_CLAIM } from '../server/src/routes/claims';

export async function runDocumentsSuite(): Promise<TestItem[]> {
  const tests: TestItem[] = [];
  function record(id: string, name: string, condition: boolean, details?: string) {
    tests.push({ id, name, pass: condition, details });
    console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${id}: ${name}${details ? ` -> ${details}` : ''}`);
  }

  console.log('\n--- SUITE 5: Comprehensive Document Management & BYTEA Tests ---');

  const adminLogin = await requestApi('POST', '/api/auth/login', { email: 'admin@pilship.com', password: 'Password123!' });
  const adminToken = adminLogin.body.token;

  const agency1Login = await requestApi('POST', '/api/auth/login', { email: 'agency@pilship.com', password: 'Password123!' });
  const agency1Token = agency1Login.body.token;

  const agency2Login = await requestApi('POST', '/api/auth/login', { email: 'agency2@pilship.com', password: 'Password123!' });
  const agency2Token = agency2Login.body.token;

  // 1. File Upload Security: Reject dangerous executable upload (.exe)
  const exeFormData = new FormData();
  exeFormData.append('file', new Blob([Buffer.from('MZ_DANGEROUS_EXE_CODE')], { type: 'application/octet-stream' }), 'malware.exe');
  const exeRes = await fetch(`${BASE_URL}/api/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${agency1Token}` },
    body: exeFormData,
  });
  record('DOC-5.1', 'Executable (.exe) upload rejected with 400 Bad Request', exeRes.status === 400);

  // 2. File Upload Security: Reject invalid header / spoofed extension
  const spoofFormData = new FormData();
  spoofFormData.append('file', new Blob([Buffer.from('NOT_A_REAL_PNG')], { type: 'image/png' }), 'fake.png');
  const spoofRes = await fetch(`${BASE_URL}/api/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${agency1Token}` },
    body: spoofFormData,
  });
  record('DOC-5.2', 'Spoofed extension with invalid binary header rejected (400 Bad Request)', spoofRes.status === 400);

  // 3. Valid PNG Upload (with authentic 8-byte PNG header)
  const validPngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const samplePayload = Buffer.concat([validPngHeader, Buffer.from('TEST_PAYLOAD_PACIFIC_INTERNATIONAL_LINES')]);
  const originalSha256 = crypto.createHash('sha256').update(samplePayload).digest('hex');

  const uploadFormData = new FormData();
  uploadFormData.append('file', new Blob([samplePayload], { type: 'image/png' }), 'cargo_inspection_proof.png');
  const uploadRes = await fetch(`${BASE_URL}/api/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${agency1Token}` },
    body: uploadFormData,
  });
  const uploadData = await uploadRes.json();

  record(
    'DOC-5.3',
    'Valid document uploaded directly to PostgreSQL BYTEA with SHA-256 calculation',
    uploadRes.status === 200 && Boolean(uploadData.attachment_id) && uploadData.checksum === originalSha256,
    `Checksum: ${uploadData.checksum?.substring(0, 10)}...`
  );

  const attachmentId = uploadData.attachment_id;

  // 4. Verify binary is stored in attachment_contents table
  const contentRow = (await db.prepare('SELECT file_data FROM attachment_contents WHERE attachment_id = ?').get(attachmentId)) as any;
  const binaryBuffer = Buffer.isBuffer(contentRow?.file_data) ? contentRow.file_data : Buffer.from(contentRow?.file_data || '');
  const dbSha256 = crypto.createHash('sha256').update(binaryBuffer).digest('hex');
  record('DOC-5.4', 'Binary BYTEA data stored in PostgreSQL attachment_contents matches upload checksum exactly', dbSha256 === originalSha256);

  // 5. Associate document with a claim (all mandatory requirements satisfied)
  const claimRes = await requestApi('POST', '/api/claims', {
    bl_number: 'PIL0100005',
    claimant: 'Pacific Freight Services',
    discharge_date: '2026-05-18',
    attachments: [
      {
        id: attachmentId,
        attachment_id: attachmentId,
        file_name: 'cargo_inspection_proof.png',
        file_size: samplePayload.length,
        file_type: 'image/png',
        file_url: uploadData.file_url,
        type: "Claimant's Survey Report with Colour Photographs",
        mandatory_attachment_type: "Claimant's Survey Report with Colour Photographs",
      },
      ...MANDATORY_DOCS_DRY_CLAIM
        .filter(d => d !== "Claimant's Survey Report with Colour Photographs")
        .map(d => ({ type: d, comment: 'Automated test verified' }))
    ]
  }, agency1Token);
  const claimId = claimRes.body.id;

  // 6. Authenticated document download (Agency 1 can download own document)
  const downloadRes = await fetch(`${BASE_URL}/api/files/${attachmentId}/download`, {
    headers: { Authorization: `Bearer ${agency1Token}` },
  });
  const downloadedBytes = Buffer.from(await downloadRes.arrayBuffer());
  const downloadedSha256 = crypto.createHash('sha256').update(downloadedBytes).digest('hex');
  record(
    'DOC-5.5',
    'Authenticated document download returns intact binary with matching SHA-256 and attachment header',
    downloadRes.status === 200 &&
    downloadRes.headers.get('content-disposition')?.includes('attachment') === true &&
    downloadedSha256 === originalSha256
  );

  // 7. In-browser document preview
  const previewRes = await fetch(`${BASE_URL}/api/files/${attachmentId}/preview`, {
    headers: { Authorization: `Bearer ${agency1Token}` },
  });
  record(
    'DOC-5.6',
    'Authenticated document preview returns binary with inline disposition for browser rendering',
    previewRes.status === 200 && previewRes.headers.get('content-disposition')?.includes('inline') === true
  );

  // 8. Cross-agency security: Agency 2 CANNOT download Agency 1 document (403 Forbidden)
  const agency2DownloadRes = await fetch(`${BASE_URL}/api/files/${attachmentId}/download`, {
    headers: { Authorization: `Bearer ${agency2Token}` },
  });
  record('DOC-5.7', 'Cross-agency document access strictly prohibited (Agency 2 gets 403 Forbidden)', agency2DownloadRes.status === 403);

  // 9. Unauthenticated download rejected (401 Unauthorized)
  const unauthDownloadRes = await fetch(`${BASE_URL}/api/files/${attachmentId}/download`);
  record('DOC-5.8', 'Unauthenticated download request rejected with 401 Unauthorized', unauthDownloadRes.status === 401);

  // 10. Document Search API: Filter by BL Number
  const searchByBl = await requestApi('GET', '/api/attachments/search?bl_number=PIL0100005', null, agency1Token);
  record(
    'DOC-5.9',
    'Document search API finds documents by BL number',
    searchByBl.status === 200 && searchByBl.body.documents?.some((d: any) => d.id === attachmentId)
  );

  // 11. Document Search API: Cross-Agency Isolation
  // Agency 2 searches same BL: must find 0 documents because they do not own the claim
  const agency2Search = await requestApi('GET', '/api/attachments/search?bl_number=PIL0100005', null, agency2Token);
  const agency2Total = agency2Search.body.pagination ? agency2Search.body.pagination.total : agency2Search.body.total;
  const agency2Docs = agency2Search.body.documents || [];
  record(
    'DOC-5.10',
    'Document search isolates metadata across agencies (Agency 2 discovers 0 documents)',
    agency2Search.status === 200 && agency2Total === 0 && agency2Docs.length === 0,
    `Discovered: ${agency2Docs.length} docs, Total: ${agency2Total}`
  );

  // 12. Binary BYTEA is NEVER exposed in document metadata search responses
  const hasBinaryInMetadata = searchByBl.body.documents?.some((d: any) => d.file_data !== undefined);
  record('DOC-5.11', 'Binary BYTEA data strictly excluded from search metadata responses (memory optimization)', !hasBinaryInMetadata);

  // 13. Office Signature Validation: Valid DOCX accepted with PK\x03\x04 header
  const validDocxPayload = Buffer.concat([Buffer.from([0x50, 0x4B, 0x03, 0x04]), Buffer.from('WORD_DOCUMENT_ZIP_DATA')]);
  const docxFormData = new FormData();
  docxFormData.append('file', new Blob([validDocxPayload], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), 'survey_findings.docx');
  const docxRes = await fetch(`${BASE_URL}/api/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${agency1Token}` },
    body: docxFormData,
  });
  const docxData = await docxRes.json().catch(() => ({}));
  record('DOC-5.12', 'Valid Office DOCX accepted with authentic PK\\x03\\x04 ZIP container header (200 OK)', docxRes.status === 200 && Boolean(docxData.attachment_id));

  // 14. Office Signature Validation: Valid XLSX accepted with PK\x03\x04 header
  const validXlsxPayload = Buffer.concat([Buffer.from([0x50, 0x4B, 0x03, 0x04]), Buffer.from('EXCEL_SPREADSHEET_ZIP_DATA')]);
  const xlsxFormData = new FormData();
  xlsxFormData.append('file', new Blob([validXlsxPayload], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'cargo_tally.xlsx');
  const xlsxRes = await fetch(`${BASE_URL}/api/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${agency1Token}` },
    body: xlsxFormData,
  });
  const xlsxData = await xlsxRes.json().catch(() => ({}));
  record('DOC-5.13', 'Valid Office XLSX accepted with authentic PK\\x03\\x04 ZIP container header (200 OK)', xlsxRes.status === 200 && Boolean(xlsxData.attachment_id));

  // 15. Office Signature Validation: Valid legacy DOC and XLS accepted with OLE2 header (D0 CF 11 E0 A1 B1 1A E1)
  const ole2Header = Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]);
  const validDocPayload = Buffer.concat([ole2Header, Buffer.from('LEGACY_DOC_DATA')]);
  const docFormData = new FormData();
  docFormData.append('file', new Blob([validDocPayload], { type: 'application/msword' }), 'old_survey.doc');
  const docRes = await fetch(`${BASE_URL}/api/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${agency1Token}` },
    body: docFormData,
  });

  const validXlsPayload = Buffer.concat([ole2Header, Buffer.from('LEGACY_XLS_DATA')]);
  const xlsFormData = new FormData();
  xlsFormData.append('file', new Blob([validXlsPayload], { type: 'application/vnd.ms-excel' }), 'old_manifest.xls');
  const xlsRes = await fetch(`${BASE_URL}/api/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${agency1Token}` },
    body: xlsFormData,
  });
  record('DOC-5.14', 'Valid legacy Office formats (.doc and .xls) accepted with authentic OLE2 CFB headers (200 OK)', docRes.status === 200 && xlsRes.status === 200);

  // 16. Office Signature Validation: Spoofed DOCX rejected (missing PK\x03\x04 header)
  const spoofedDocxPayload = Buffer.from('PLAIN_TEXT_DISGUISED_AS_DOCX_FILE_WITHOUT_PK_HEADER');
  const spoofDocxFormData = new FormData();
  spoofDocxFormData.append('file', new Blob([spoofedDocxPayload], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), 'spoofed_document.docx');
  const spoofDocxRes = await fetch(`${BASE_URL}/api/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${agency1Token}` },
    body: spoofDocxFormData,
  });
  record('DOC-5.15', 'Spoofed DOCX with invalid or missing ZIP header rejected with 400 Bad Request', spoofDocxRes.status === 400);

  // 17. Office Signature Validation: Spoofed XLSX rejected (executable payload disguised as .xlsx)
  const spoofedXlsxPayload = Buffer.from('MZ_EXECUTABLE_BINARY_DATA_DISGUISED_AS_EXCEL_SPREADSHEET');
  const spoofXlsxFormData = new FormData();
  spoofXlsxFormData.append('file', new Blob([spoofedXlsxPayload], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'spoofed_sheet.xlsx');
  const spoofXlsxRes = await fetch(`${BASE_URL}/api/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${agency1Token}` },
    body: spoofXlsxFormData,
  });
  record('DOC-5.16', 'Spoofed XLSX with executable MZ payload rejected with 400 Bad Request', spoofXlsxRes.status === 400);

  // 18. Plain text tabular format: CSV accepted without binary signature requirement
  const csvPayload = Buffer.from('ContainerNumber,SealNumber,DamageDescription,WeightKG\nPILU9876543,SL-0012,Dent on door,22400\nPILU1234567,SL-0013,Wet carton base,18500\n');
  const csvFormData = new FormData();
  csvFormData.append('file', new Blob([csvPayload], { type: 'text/csv' }), 'container_manifest.csv');
  const csvRes = await fetch(`${BASE_URL}/api/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${agency1Token}` },
    body: csvFormData,
  });
  const csvData = await csvRes.json().catch(() => ({}));
  record('DOC-5.17', 'Plain text CSV accepted cleanly without requiring binary signatures (200 OK)', csvRes.status === 200 && Boolean(csvData.attachment_id));

  return tests;
}
