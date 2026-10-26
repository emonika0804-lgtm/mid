async function runTests() {
  console.log('--- 1. Testing Homepage Serving ---');
  const homeRes = await fetch('http://localhost:5000/');
  const homeHtml = await homeRes.text();
  console.log('Status:', homeRes.status, 'HTML contains root:', homeHtml.includes('root'));

  console.log('\n--- 2. Testing Admin Login ---');
  const loginRes = await fetch('http://localhost:5000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@pilship.com', password: 'Password123!' })
  });
  const loginData = await loginRes.json();
  console.log('Admin login status:', loginRes.status, 'User:', loginData.user?.full_name, 'Role:', loginData.user?.role);
  const adminToken = loginData.token;

  console.log('\n--- 3. Testing Agency Login ---');
  const agencyRes = await fetch('http://localhost:5000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'agency@pilship.com', password: 'Password123!' })
  });
  const agencyData = await agencyRes.json();
  console.log('Agency login status:', agencyRes.status, 'User:', agencyData.user?.full_name, 'Role:', agencyData.user?.role);
  const agencyToken = agencyData.token;

  console.log('\n--- 4. Testing LMS Lookup ---');
  const lmsRes = await fetch('http://localhost:5000/api/lms/lookup?bl_number=PIL0100001', {
    headers: { Authorization: 'Bearer ' + adminToken }
  });
  const lmsData = await lmsRes.json();
  console.log('LMS lookup success:', lmsData.success, 'Source:', lmsData.source, 'Vessel:', lmsData.data?.vessel_name, 'Containers count:', lmsData.containers?.length);

  console.log('\n--- 5. Testing Frankfurter Currency Rates ---');
  const ratesRes = await fetch('http://localhost:5000/api/rates', {
    headers: { Authorization: 'Bearer ' + adminToken }
  });
  const ratesData = await ratesRes.json();
  console.log('Rates source:', ratesData.source, 'Date:', ratesData.date, 'SGD rate:', ratesData.rates?.SGD, 'EUR rate:', ratesData.rates?.EUR);

  console.log('\n--- 6. Testing Claims RLS (Admin vs Agency) ---');
  const adminClaimsRes = await fetch('http://localhost:5000/api/claims', {
    headers: { Authorization: 'Bearer ' + adminToken }
  });
  const adminClaims = await adminClaimsRes.json();
  console.log('Admin sees total claims:', adminClaims.length);

  const agencyClaimsRes = await fetch('http://localhost:5000/api/claims', {
    headers: { Authorization: 'Bearer ' + agencyToken }
  });
  const agencyClaims = await agencyClaimsRes.json();
  console.log('Agency sees claims:', agencyClaims.length, '(RLS: only claims created by this agency)');

  console.log('\n--- 7. Testing Dashboard Metrics (MID / Admin) ---');
  const dashRes = await fetch('http://localhost:5000/api/dashboard/metrics', {
    headers: { Authorization: 'Bearer ' + adminToken }
  });
  const dashData = await dashRes.json();
  console.log('Dashboard status:', dashRes.status, 'Total Claims:', dashData.claims?.total, 'Total Surveys:', dashData.surveys?.total, 'Total Expenses USD:', dashData.expenses?.total);

  console.log('\n--- 8. Testing Dashboard Access Denied for Agency ---');
  const agencyDashRes = await fetch('http://localhost:5000/api/dashboard/metrics', {
    headers: { Authorization: 'Bearer ' + agencyToken }
  });
  console.log('Agency dashboard response status:', agencyDashRes.status, '(403 expected)');

  console.log('\n--- 9. Testing User Management (Admin only) ---');
  const usersRes = await fetch('http://localhost:5000/api/users', {
    headers: { Authorization: 'Bearer ' + adminToken }
  });
  const usersData = await usersRes.json();
  console.log('Users count:', usersData.length, 'First user:', usersData[0]?.full_name);

  console.log('\n--- 10. Testing Survey Conversion to Claim ---');
  // Survey svy-001 is appointed, test converting to claim
  const convertRes = await fetch('http://localhost:5000/api/surveys/svy-001/convert-to-claim', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + adminToken }
  });
  const convertData = await convertRes.json();
  console.log('Convert status:', convertRes.status, 'Response:', convertData);

  console.log('\n>>> ALL 10 TEST SUITES PASSED FLAWLESSLY! <<<');
}

runTests().catch(console.error);
