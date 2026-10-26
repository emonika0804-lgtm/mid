const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const { Client } = require('pg');

const projectRoot = path.resolve(__dirname, '..');
const envPath = path.resolve(projectRoot, '.env');

console.log('--- ENVIRONMENT CONFIGURATION CHECK ---');
console.log('Project root path:', projectRoot);
console.log('.env file path:   ', envPath);

const envExists = fs.existsSync(envPath);
console.log('.env file exists: ', envExists ? 'YES' : 'NO');

if (!envExists) {
  console.error('ERROR: .env file was not found at project root.');
  process.exit(1);
}

// Load .env
const dotenvResult = dotenv.config({ path: envPath });
if (dotenvResult.error) {
  console.error('ERROR: Failed to parse .env file:', dotenvResult.error.message);
  process.exit(1);
}

console.log('\n--- DATABASE ENVIRONMENT VARIABLES AVAILABILITY ---');
const requiredVars = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];

let allAvailable = true;
for (const varName of requiredVars) {
  const val = process.env[varName];
  const isSet = typeof val === 'string' && val.trim().length > 0;
  console.log(`${varName.padEnd(14)}: ${isSet ? 'AVAILABLE (Set)' : 'MISSING / EMPTY'}`);
  if (!isSet) allAvailable = false;
}

if (!allAvailable) {
  console.error('\nERROR: One or more required database environment variables are missing or empty.');
  process.exit(1);
}

console.log('\n--- TESTING POSTGRESQL CONNECTION ---');
console.log('Connecting using environment variables...');

const client = new Client({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  connectionTimeoutMillis: 5000,
});

async function run() {
  try {
    await client.connect();
    console.log('Connection established successfully.');

    const res = await client.query('SELECT current_database(), current_user');
    console.log('\n--- CONNECTION QUERY RESULT ---');
    console.log('current_database():', res.rows[0].current_database);
    console.log('current_user:      ', res.rows[0].current_user);
    console.log('\nSTATUS: SUCCESS - PostgreSQL connection verified.');
    await client.end();
    process.exit(0);
  } catch (err) {
    console.error('\nSTATUS: FAILED - Could not connect to PostgreSQL:');
    console.error(err.message || String(err));
    await client.end().catch(() => {});
    process.exit(1);
  }
}

run();
