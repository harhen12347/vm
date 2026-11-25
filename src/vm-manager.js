const { spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const { constants: fsConstants, createWriteStream } = require('node:fs');
const https = require('node:https');
const net = require('node:net');
const path = require('node:path');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const UBUNTU_ISO = {
  fileName: 'ubuntu-24.04.5.1-desktop-amd64.iso',
  url: 'https://releases.ubuntu.com/24.04/ubuntu-24.04.5.1-desktop-amd64.iso',
  sha256: '4da4a0c9035da8e68a59a838674f403f0a54472c78a83b4fb7f78d03588f85a7',
  size: 6250332160
};
const VM_MEMORY_MB = 4096;
const VM_CPU_COUNT = 2;
const VM_DISK_SIZE = '32G';
const VM_VNC_DISPLAY = 0;
const VM_VNC_WEBSOCKET_PORT = 5700;

function buildQemuArgs({ isoPath, diskPath, sharedPath, monitorPath, accelerator }) {
  if (!['kvm', 'tcg'].includes(accelerator)) throw new TypeError('Unsupported QEMU accelerator.');
  return [
    '-name', 'Aether Ubuntu Desktop',
    '-machine', 'q35',
    '-accel', accelerator === 'tcg' ? 'tcg,thread=multi' : 'kvm',
    '-cpu', accelerator === 'kvm' ? 'host' : 'max',
    '-m', String(VM_MEMORY_MB),
    '-smp', String(VM_CPU_COUNT),
    '-drive', `file=${diskPath},if=virtio,format=qcow2`,
    '-cdrom', isoPath,
    '-boot', 'order=dc,menu=on',
    '-device', 'virtio-vga',
    '-netdev', 'user,id=net0',
    '-device', 'e1000,netdev=net0',
    '-virtfs', `local,path=${sharedPath},mount_tag=hostshare,security_model=none,id=hostshare`,
    '-display', 'none',
    '-vnc', `127.0.0.1:${VM_VNC_DISPLAY},websocket=${VM_VNC_WEBSOCKET_PORT}`,
    '-qmp', `unix:${monitorPath},server=on,wait=off`
  ];
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function findExecutable(name, envPath = process.env.PATH || '') {
  for (const directory of envPath.split(path.delimiter)) {
    if (!directory) continue;
    const candidate = path.join(directory, name);
    try {
      await fs.access(candidate, fsConstants.X_OK);
      return candidate;
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'EACCES') throw error;
    }
  }
  return null;
}

function getHttpsResponse(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { timeout: 30000 }, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        const location = response.headers.location;
        response.resume();
        if (!location || redirects >= 5) {
          reject(new Error('Ubuntu download returned too many redirects.'));
          return;
        }
        const nextUrl = new URL(location, url);
        if (nextUrl.protocol !== 'https:' || nextUrl.hostname !== 'releases.ubuntu.com') {
          reject(new Error('Ubuntu download redirected to an unexpected host.'));
          return;
        }
        getHttpsResponse(nextUrl, redirects + 1).then(resolve, reject);
        return;
      }
      resolve(response);
    });
    request.on('timeout', () => request.destroy(new Error('Ubuntu download timed out.')));
    request.on('error', reject);
  });
}

async function downloadIso(isoPath, onProgress) {
  const partialPath = `${isoPath}.part`;
  await fs.rm(partialPath, { force: true });

  try {
    const response = await getHttpsResponse(new URL(UBUNTU_ISO.url));
    if (response.statusCode !== 200) {
      response.resume();
      throw new Error(`Ubuntu download failed with HTTP ${response.statusCode}.`);
    }

    const total = Number(response.headers['content-length']) || UBUNTU_ISO.size;
    let received = 0;
    const hash = createHash('sha256');
    const meter = new Transform({
      transform(chunk, _encoding, callback) {
        received += chunk.length;
        hash.update(chunk);
        onProgress({ received, total, percent: Math.min(100, received / total * 100) });
        callback(null, chunk);
      }
    });
    await pipeline(response, meter, createWriteStream(partialPath, { flags: 'wx' }));

    if (received !== UBUNTU_ISO.size || hash.digest('hex') !== UBUNTU_ISO.sha256) {
      throw new Error('Ubuntu ISO verification failed; the incomplete download was discarded.');
    }
    await fs.rename(partialPath, isoPath);
  } catch (error) {
    await fs.rm(partialPath, { force: true });
    throw error;
  }
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const process = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    process.stderr.setEncoding('utf8');
    process.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-4096); });
    process.once('error', reject);
    process.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `${path.basename(command)} exited with code ${code}.`));
    });
  });
}

function sendQmpCommand(socketPath, command) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let buffer = '';
    let negotiated = false;
    let commandSent = false;
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error('Timed out waiting for the virtual machine monitor.'));
    }, 3000);
    const finish = (error) => {
      clearTimeout(timeout);
      socket.destroy();
      if (error) reject(error);
      else resolve();
    };

    socket.setEncoding('utf8');
    socket.once('error', finish);
    socket.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split('\r\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line) continue;
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (message.QMP && !negotiated) {
          negotiated = true;
          socket.write('{"execute":"qmp_capabilities"}\r\n');
        } else if (negotiated && !commandSent && (message.return || message.error)) {
          if (message.error) {
            finish(new Error(message.error.desc || 'Could not initialize the virtual machine monitor.'));
            return;
          }
          socket.write(`${JSON.stringify({ execute: command })}\r\n`);
          commandSent = true;
        } else if (commandSent && (message.return || message.error)) {
          finish(message.error ? new Error(message.error.desc || 'Virtual machine command failed.') : null);
          return;
        }
      }
    });
  });
}

function waitForExit(exitPromise, timeoutMs) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(false), timeoutMs);
    exitPromise.then(() => {
      clearTimeout(timeout);
      resolve(true);
    });
  });
}

class UbuntuVmManager {
  constructor({ userDataPath, onProgress = () => {}, platform = process.platform, env = process.env } = {}) {
    if (!userDataPath) throw new TypeError('A user data folder is required for VM storage.');
    this.directory = path.join(userDataPath, 'ubuntu-vm');
    this.isoPath = path.join(this.directory, UBUNTU_ISO.fileName);
    this.diskPath = path.join(this.directory, 'ubuntu.qcow2');
    this.sharedPath = path.join(this.directory, 'shared');
    this.monitorPath = path.join(this.directory, 'monitor.sock');
    this.onProgress = onProgress;
    this.platform = platform;
    this.env = env;
    this.downloadProgress = null;
    this.downloadPromise = null;
    this.child = null;
    this.exitPromise = null;
    this.lastError = null;
  }

  async status() {
    const [qemu, qemuImg, iso, disk, kvm] = await Promise.all([
      findExecutable('qemu-system-x86_64', this.env.PATH),
      findExecutable('qemu-img', this.env.PATH),
      fs.stat(this.isoPath).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error)),
      fs.stat(this.diskPath).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error)),
      this.platform === 'linux'
        ? fs.access('/dev/kvm', fsConstants.R_OK | fsConstants.W_OK).then(() => true, () => false)
        : Promise.resolve(false)
    ]);

    return {
      platform: this.platform,
      supportedPlatform: this.platform === 'linux',
      consoleAvailable: this.platform === 'linux',
      qemuInstalled: Boolean(qemu && qemuImg),
      isoPresent: iso?.size === UBUNTU_ISO.size,
      diskPresent: Boolean(disk),
      running: Boolean(this.child && this.child.exitCode === null && !this.child.killed),
      downloading: Boolean(this.downloadPromise),
      downloadProgress: this.downloadProgress,
      accelerator: kvm ? 'KVM hardware acceleration' : 'Software emulation (slower)',
      websocketPath: '/vm-ws',
      memoryMb: VM_MEMORY_MB,
      diskSize: VM_DISK_SIZE,
      lastError: this.lastError
    };
  }

  async downloadUbuntuIso() {
    if (this.downloadPromise) throw new Error('Ubuntu is already downloading.');
    await fs.mkdir(this.directory, { recursive: true });
    const existing = await fs.stat(this.isoPath).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error));
    if (existing?.size === UBUNTU_ISO.size) return this.status();
    const { bavail, bsize } = await fs.statfs(this.directory);
    if (bavail * bsize < UBUNTU_ISO.size + 1024 ** 3) {
      throw new Error('At least 7.25 GB of free storage is required to download the Ubuntu installer.');
    }

    this.downloadProgress = { received: 0, total: UBUNTU_ISO.size, percent: 0 };
    this.downloadPromise = downloadIso(this.isoPath, (progress) => {
      this.downloadProgress = progress;
      this.onProgress(progress);
    });
    try {
      await this.downloadPromise;
      this.downloadProgress = null;
      this.lastError = null;
      return await this.status();
    } catch (error) {
      this.downloadProgress = null;
      this.lastError = error.message;
      throw error;
    } finally {
      this.downloadPromise = null;
    }
  }

  async createDisk(qemuImg) {
    if (await pathExists(this.diskPath)) return;
    try {
      await runCommand(qemuImg, ['create', '-f', 'qcow2', this.diskPath, VM_DISK_SIZE]);
    } catch (error) {
      await fs.rm(this.diskPath, { force: true });
      throw error;
    }
  }

  async start() {
    if (this.platform !== 'linux') throw new Error('The Ubuntu VM currently requires a Linux host.');
    if (this.child && this.child.exitCode === null && !this.child.killed) {
      throw new Error('The Ubuntu VM is already running.');
    }

    const qemu = await findExecutable('qemu-system-x86_64', this.env.PATH);
    const qemuImg = await findExecutable('qemu-img', this.env.PATH);
    if (!qemu || !qemuImg) {
      throw new Error('QEMU is missing. On Ubuntu or Debian, install it with: sudo apt install qemu-system-x86 qemu-utils');
    }
    const iso = await fs.stat(this.isoPath).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error));
    if (iso?.size !== UBUNTU_ISO.size) {
      throw new Error('Download and verify the Ubuntu Desktop installer before starting the VM.');
    }

    await fs.mkdir(this.directory, { recursive: true });
    await fs.mkdir(this.sharedPath, { recursive: true });
    await this.createDisk(qemuImg);
    await fs.rm(this.monitorPath, { force: true });
    const kvm = this.platform === 'linux'
      && await fs.access('/dev/kvm', fsConstants.R_OK | fsConstants.W_OK).then(() => true, () => false);
    const args = buildQemuArgs({
      isoPath: this.isoPath,
      diskPath: this.diskPath,
      sharedPath: this.sharedPath,
      monitorPath: this.monitorPath,
      accelerator: kvm ? 'kvm' : 'tcg'
    });

    this.lastError = null;
    const child = spawn(qemu, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    this.child = child;
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-4096); });
    this.exitPromise = new Promise((resolve) => {
      child.once('error', (error) => {
        this.lastError = error.message;
        if (this.child === child) this.child = null;
        resolve({ error });
      });
      child.once('exit', (code, signal) => {
        if (code && this.child === child) this.lastError = stderr.trim() || `QEMU exited with code ${code} (${signal || 'no signal'}).`;
        if (this.child === child) this.child = null;
        resolve({ code, signal });
      });
    });
    await new Promise((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    if (child.exitCode !== null) {
      await this.exitPromise;
      throw new Error(this.lastError || 'QEMU closed before the VM could start.');
    }
    return this.status();
  }

  async requestShutdown() {
    if (!this.child || this.child.exitCode !== null || this.child.killed) {
      throw new Error('The Ubuntu VM is not running.');
    }
    await sendQmpCommand(this.monitorPath, 'system_powerdown');
  }

  async stop() {
    const child = this.child;
    if (!child || child.exitCode !== null || child.killed) return;

    try {
      await this.requestShutdown();
    } catch (error) {
      this.lastError = `Could not request a graceful VM shutdown: ${error.message}`;
    }
    if (await waitForExit(this.exitPromise, 15000)) return;
    child.kill('SIGTERM');
    if (await waitForExit(this.exitPromise, 3000)) return;
    child.kill('SIGKILL');
    await this.exitPromise.catch(() => {});
  }
}

module.exports = {
  UBUNTU_ISO,
  UbuntuVmManager,
  buildQemuArgs,
  VM_VNC_WEBSOCKET_PORT
};
