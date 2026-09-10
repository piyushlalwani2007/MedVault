const { spawn } = require('child_process');
const net = require('net');
const path = require('path');

const projectRoot = __dirname;
const backendPath = path.join(projectRoot, 'backend');
const frontendPath = path.join(projectRoot, 'frontend');
const processes = [];

function isPortInUse(port) {
  return new Promise(resolve => {
    const server = net.createServer();
    server.once('error', error => resolve(error.code === 'EADDRINUSE'));
    server.once('listening', () => server.close(() => resolve(false)));
    server.listen(port, '127.0.0.1');
  });
}

function startProcess(label, command, args, cwd) {
  const child = spawn(command, args, {
    cwd,
    stdio: ['inherit', 'pipe', 'pipe'],
    env: process.env
  });

  child.stdout.on('data', data => process.stdout.write(`[${label}] ${data}`));
  child.stderr.on('data', data => process.stderr.write(`[${label}] ${data}`));
  child.on('error', error => console.error(`[${label}] ${error.message}`));
  child.on('exit', code => {
    if (code && !shuttingDown) {
      console.error(`[${label}] stopped with exit code ${code}`);
    }
  });

  processes.push(child);
  return child;
}

let shuttingDown = false;

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('\nStopping servers...');
  processes.forEach(child => child.kill('SIGTERM'));
  setTimeout(() => process.exit(0), 500);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

(async () => {
  if (await isPortInUse(5000)) {
    console.log('[backend] already running on port 5000');
  } else {
    startProcess('backend', process.execPath, ['server.js'], backendPath);
  }

  if (await isPortInUse(8000)) {
    console.log('[frontend] already running on port 8000');
  } else {
    startProcess('frontend', 'python3', ['-m', 'http.server', '8000'], frontendPath);
  }

  console.log('\nHospital Discharge System started.');
  console.log('Frontend: http://localhost:8000');
  console.log('Backend:  http://localhost:5000');
  console.log('Press Ctrl+C to stop servers started by this command.\n');
})();
