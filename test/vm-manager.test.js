const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { after, before, test } = require('node:test');
const { UbuntuVmManager, buildQemuArgs, VM_VNC_WEBSOCKET_PORT } = require('../src/vm-manager');

let dataDirectory;

before(async () => {
  dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'aether-vm-'));
});

after(async () => {
  await fs.rm(dataDirectory, { recursive: true, force: true });
});

test('builds safe QEMU arguments for a persistent Ubuntu guest', () => {
  const args = buildQemuArgs({
    isoPath: '/home/user/Ubuntu Desktop.iso',
    diskPath: '/home/user/ubuntu.qcow2',
    sharedPath: '/home/user/shared',
    monitorPath: '/home/user/monitor.sock',
    accelerator: 'kvm'
  });

  assert.ok(args.includes('/home/user/Ubuntu Desktop.iso'));
  assert.ok(args.some((arg) => arg.startsWith('file=/home/user/ubuntu.qcow2,')));
  assert.ok(args.includes('q35'));
  assert.equal(args[args.indexOf('-accel') + 1], 'kvm');
  assert.ok(args.includes('order=dc,menu=on'));
  assert.ok(args.includes('local,path=/home/user/shared,mount_tag=hostshare,security_model=none,id=hostshare'));
  assert.ok(args.includes(`127.0.0.1:0,websocket=${VM_VNC_WEBSOCKET_PORT}`));
  assert.ok(args.includes('none'));
  assert.ok(args.includes('-qmp'));
  const tcgArgs = buildQemuArgs({
    isoPath: '/home/user/Ubuntu Desktop.iso',
    diskPath: '/home/user/ubuntu.qcow2',
    sharedPath: '/home/user/shared',
    monitorPath: '/home/user/monitor.sock',
    accelerator: 'tcg'
  });
  assert.equal(tcgArgs[tcgArgs.indexOf('-accel') + 1], 'tcg,thread=multi');
  assert.throws(() => buildQemuArgs({
    isoPath: 'installer.iso',
    diskPath: 'disk.qcow2',
    sharedPath: 'shared',
    monitorPath: 'monitor.sock',
    accelerator: 'unknown'
  }), /Unsupported QEMU accelerator/);
});

test('reports missing VM prerequisites without claiming the guest is ready', async () => {
  const manager = new UbuntuVmManager({
    userDataPath: dataDirectory,
    platform: 'win32',
    env: { PATH: '' }
  });
  const status = await manager.status();

  assert.equal(status.supportedPlatform, false);
  assert.equal(status.qemuInstalled, false);
  assert.equal(status.isoPresent, false);
  assert.equal(status.running, false);
  await assert.rejects(manager.start(), /requires a Linux host/);
});

test('requires QEMU before attempting to start a browser VM', async () => {
  const manager = new UbuntuVmManager({
    userDataPath: dataDirectory,
    platform: 'linux',
    env: { PATH: '' }
  });

  await assert.rejects(manager.start(), /QEMU is missing/);
});
