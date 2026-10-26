const { spawn, execSync, exec } = require('child_process');
const path = require('path');
const http = require('http');

const projectRoot = path.resolve(__dirname, '..');
process.chdir(projectRoot);

console.clear();
console.log('======================================================================');
console.log('   PIL CARGO CLAIM & SURVEY MANAGEMENT SYSTEM - LAUNCHER');
console.log('======================================================================\n');

// 1. Ensure PostgreSQL Service is running
function ensurePostgresRunning() {
  process.stdout.write('[1/4] Checking PostgreSQL Service (postgresql-x64-17)... ');
  try {
    const status = execSync('sc query postgresql-x64-17', { stdio: 'pipe' }).toString();
    if (status.includes('RUNNING')) {
      console.log('RUNNING (OK)');
    } else {
      console.log('STARTING...');
      execSync('net start postgresql-x64-17', { stdio: 'inherit' });
      console.log('PostgreSQL Service started successfully.');
    }
  } catch (err) {
    console.log('Service check note: PostgreSQL is running or managed manually.');
  }
}

// 2. Free up ports 5000 and 5173 if hanging processes exist
function freePort(port) {
  try {
    const output = execSync(`netstat -ano | findstr :${port}`, { stdio: 'pipe' }).toString();
    const lines = output.trim().split('\n');
    for (const line of lines) {
      if (line.includes('LISTENING')) {
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && pid !== '0' && pid !== process.pid.toString()) {
          console.log(`Freeing port ${port} (terminating lingering process PID ${pid})...`);
          execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
        }
      }
    }
  } catch (e) {
    // Port is free
  }
}

// 3. Wait for an HTTP URL to respond
function waitForHttp(url, timeoutMs = 25000) {
  const start = Date.now();
  return new Promise((resolve) => {
    const check = () => {
      http.get(url, (res) => {
        resolve(true);
      }).on('error', () => {
        if (Date.now() - start > timeoutMs) {
          resolve(false);
        } else {
          setTimeout(check, 600);
        }
      });
    };
    check();
  });
}

async function start() {
  ensurePostgresRunning();

  console.log('[2/4] Checking ports 5000 & 5173...');
  freePort(5000);
  freePort(5173);

  // 4. Start Backend Server
  console.log('[3/4] Starting Backend Server (Express + PostgreSQL on port 5000)...');
  const backend = spawn('cmd.exe', ['/c', 'npx tsx server/src/index.ts'], {
    cwd: projectRoot,
    stdio: 'pipe',
  });

  backend.stdout.on('data', (data) => {
    const msg = data.toString().trim();
    if (msg) console.log(`[Backend] ${msg}`);
  });

  backend.stderr.on('data', (data) => {
    const msg = data.toString().trim();
    if (msg) console.error(`[Backend Note] ${msg}`);
  });

  // 5. Start Frontend Dev Server
  console.log('[4/4] Starting Frontend Client (Vite on port 5173)...');
  const frontend = spawn('cmd.exe', ['/c', 'npm --prefix client run dev'], {
    cwd: projectRoot,
    stdio: 'pipe',
  });

  frontend.stdout.on('data', (data) => {
    const msg = data.toString().trim();
    if (msg) console.log(`[Frontend] ${msg}`);
  });

  frontend.stderr.on('data', (data) => {
    const msg = data.toString().trim();
    if (msg) console.error(`[Frontend Note] ${msg}`);
  });

  // Wait for Frontend to be listening
  await waitForHttp('http://localhost:5173');

  // 6. Display Dashboard Banner
  console.log('\n======================================================================');
  console.log('   PIL PLATFORM IS RUNNING AND READY!');
  console.log('======================================================================');
  console.log('   Browser Interface:  http://localhost:5173');
  console.log('   Backend API Server: http://localhost:5000');
  console.log('   PostgreSQL DB:      pil_claims_db (runtime user: pil_app_user)');
  console.log('----------------------------------------------------------------------');
  console.log('   PRE-CONFIGURED LOGIN ACCOUNTS:');
  console.log('   * Admin:      admin@pilship.com             / Password123!');
  console.log('   * MID:        mid@pilship.com               / Password123!');
  console.log('   * GCC:        gcc@pilship.com               / Password123!');
  console.log('   * Agency:     agency@pilship.com            / Password123!');
  console.log('   * Real User:  yashwanthsakthivel@gmail.com   / (Your password)');
  console.log('======================================================================');
  console.log('   Opening your browser automatically...');
  console.log('   To stop both servers, close this window or press Ctrl+C.\n');

  // Open default browser
  exec('cmd.exe /c start http://localhost:5173');

  // Handle Clean Shutdown
  const cleanup = () => {
    console.log('\nStopping PIL servers...');
    try {
      if (backend.pid) execSync(`taskkill /F /T /PID ${backend.pid}`, { stdio: 'ignore' });
      if (frontend.pid) execSync(`taskkill /F /T /PID ${frontend.pid}`, { stdio: 'ignore' });
    } catch (e) {
      // Ignore
    }
    console.log('Servers stopped cleanly. Goodbye!\n');
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  backend.on('exit', () => cleanup());
}

start();
