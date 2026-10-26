const Database = require('better-sqlite3');
const fs = require('fs');
const db = new Database('./pil_claims.db');

console.log('--- DATABASE RECORD COUNTS ---');
console.log('users:', db.prepare('SELECT COUNT(*) as c FROM users').get().c);
console.log('claims:', db.prepare('SELECT COUNT(*) as c FROM claims').get().c);
console.log('surveys:', db.prepare('SELECT COUNT(*) as c FROM surveys').get().c);
console.log('audit_logs:', db.prepare('SELECT COUNT(*) as c FROM audit_logs').get().c);
console.log('expenses:', db.prepare('SELECT COUNT(*) as c FROM expenses').get().c);
console.log('recoveries:', db.prepare('SELECT COUNT(*) as c FROM recoveries').get().c);
console.log('notifications:', db.prepare('SELECT COUNT(*) as c FROM notifications').get().c);
console.log('currency_rates:', db.prepare('SELECT COUNT(*) as c FROM currency_rates').get().c);
console.log('lms_cache:', db.prepare('SELECT COUNT(*) as c FROM lms_cache').get().c);

console.log('\n--- UPLOADS DIRECTORY ---');
const files = fs.readdirSync('./uploads');
console.log('Total files in uploads/:', files.length);
files.forEach(f => console.log(' -', f, '(' + fs.statSync('./uploads/' + f).size + ' bytes)'));

console.log('\n--- VERIFY REAL USER ---');
const realUser = db.prepare('SELECT id, email, full_name, role, is_verified FROM users WHERE email = ?').get('yashwanthsakthivel@gmail.com');
console.log('Real user intact:', realUser);
