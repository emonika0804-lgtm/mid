const http = require('http');
const jwt = require('jsonwebtoken');
const fs = require('fs');

const JWT_SECRET = process.env.JWT_SECRET || 'pil-cargo-claims-secret-key-2026';
const agency1Token = jwt.sign(
  { id: 'usr-agency-01', email: 'agency@pilship.com', full_name: 'Singapore Port Agency', role: 'agency' },
  JWT_SECRET,
  { expiresIn: '1h' }
);
const agency2Token = jwt.sign(
  { id: 'usr-agency-02', email: 'agency2@pilship.com', full_name: 'Dubai Agency Rep', role: 'agency' },
  JWT_SECRET,
  { expiresIn: '1h' }
);
const adminToken = jwt.sign(
  { id: 'usr-admin-01', email: 'admin@pilship.com', full_name: 'System Administrator', role: 'admin' },
  JWT_SECRET,
  { expiresIn: '1h' }
);

const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
const fileContent = 'TEST_CARGO_SURVEY_REPORT_CONTENT_VERIFICATION';
const body = [
  '--' + boundary,
  'Content-Disposition: form-data; name="file"; filename="test_survey_doc.txt"',
  'Content-Type: text/plain',
  '',
  fileContent,
  '--' + boundary + '--',
  ''
].join('\r\n');

const req = http.request(
  {
    hostname: '127.0.0.1',
    port: 5000,
    path: '/api/upload',
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + agency1Token,
      'Content-Type': 'multipart/form-data; boundary=' + boundary,
      'Content-Length': Buffer.byteLength(body),
    },
  },
  (res) => {
    let data = '';
    res.on('data', (chunk) => (data += chunk));
    res.on('end', () => {
      console.log('Upload response status:', res.statusCode);
      const parsed = JSON.parse(data);
      console.log('Uploaded file_url:', parsed.file_url);
      const filename = parsed.file_url.split('/').pop();

      // Test 1: Download as Agency 1 (the uploader) -> Expect 200
      http.get(
        {
          hostname: '127.0.0.1',
          port: 5000,
          path: '/api/files/' + filename,
          headers: { Authorization: 'Bearer ' + agency1Token },
        },
        (res1) => {
          console.log('Agency 1 download status (uploader):', res1.statusCode, '(expected 200)');

          // Test 2: Download as Agency 2 (unauthorized cross-agency) -> Expect 403
          http.get(
            {
              hostname: '127.0.0.1',
              port: 5000,
              path: '/api/files/' + filename,
              headers: { Authorization: 'Bearer ' + agency2Token },
            },
            (res2) => {
              console.log('Agency 2 download status (unauthorized):', res2.statusCode, '(expected 403)');

              // Test 3: Download as Admin -> Expect 200
              http.get(
                {
                  hostname: '127.0.0.1',
                  port: 5000,
                  path: '/api/files/' + filename,
                  headers: { Authorization: 'Bearer ' + adminToken },
                },
                (res3) => {
                  console.log('Admin download status:', res3.statusCode, '(expected 200)');

                  // Clean up uploaded test file
                  const filePath = './uploads/' + filename;
                  if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                  }

                  const allOk = res1.statusCode === 200 && res2.statusCode === 403 && res3.statusCode === 200;
                  console.log('\nLifecycle Test Result:', allOk ? 'ALL PASSED ✅' : 'FAILED ❌');
                  process.exit(allOk ? 0 : 1);
                }
              );
            }
          );
        }
      );
    });
  }
);
req.write(body);
req.end();
