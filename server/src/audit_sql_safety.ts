import fs from 'fs';
import path from 'path';

function auditSqlStatements() {
  const dir = path.resolve(__dirname, '../src');
  const files: string[] = [];

  function scan(d: string) {
    for (const f of fs.readdirSync(d)) {
      const full = path.join(d, f);
      if (fs.statSync(full).isDirectory()) scan(full);
      else if (full.endsWith('.ts')) files.push(full);
    }
  }
  scan(dir);

  console.log(`Auditing ${files.length} TypeScript files for SQL query safety...`);
  let potentialConcatenations = 0;

  for (const file of files) {
    if (file.includes('test_') || file.includes('phase')) continue;
    const content = fs.readFileSync(file, 'utf-8');
    const lines = content.split('\n');

    lines.forEach((line, idx) => {
      // Look for query() or prepare() with template literals containing ${}
      if ((line.includes('query(') || line.includes('prepare(')) && line.includes('${')) {
        // Exclude safe cases like table name or WHERE clause variable if strictly controlled
        console.log(`[ALERT] Potential interpolation in ${path.basename(file)}:${idx + 1}:`);
        console.log(`   ${line.trim()}`);
        potentialConcatenations++;
      }
    });
  }

  console.log(`Audit complete. Found ${potentialConcatenations} flagged lines.`);
}

auditSqlStatements();
