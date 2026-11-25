const { spawn } = require('node:child_process');
const path = require('node:path');

const root = path.join(__dirname, '..');
const children = [];
let stopping = false;

function stopChildren(signal = 'SIGTERM') {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode === null) child.kill(signal);
  }
  const timeout = setTimeout(() => {
    for (const child of children) {
      if (child.exitCode === null) child.kill('SIGKILL');
    }
  }, 20000);
  timeout.unref();
}

function start(label, command, args, env = process.env) {
  const child = spawn(command, args, { cwd: root, env, stdio: 'inherit' });
  children.push(child);
  child.once('error', (error) => {
    console.error(`${label} failed to start: ${error.message}`);
    process.exitCode = 1;
    stopChildren();
  });
  child.once('exit', (code, signal) => {
    if (stopping) return;
    console.error(`${label} exited unexpectedly (${signal || code}).`);
    process.exitCode = code || 1;
    stopChildren();
  });
  return child;
}

start('API server', process.execPath, ['server.js'], {
  ...process.env,
  PORT: process.env.API_PORT || '3001',
  HOST: '127.0.0.1'
});
start('Web client', process.execPath, [
  path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'),
  '--config',
  'vite.config.mjs'
]);

process.on('SIGINT', () => stopChildren('SIGINT'));
process.on('SIGTERM', () => stopChildren('SIGTERM'));
