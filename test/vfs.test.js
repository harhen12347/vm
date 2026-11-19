const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { after, before, test } = require('node:test');
const { VirtualFileSystem } = require('../src/vfs');

let dataDirectory;
let dataFile;

before(async () => {
  dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'aether-vfs-'));
  dataFile = path.join(dataDirectory, 'aether-files.json');
});

after(async () => {
  await fs.rm(dataDirectory, { recursive: true, force: true });
});

test('creates the standard folders and saves concurrent writes', async () => {
  const files = new VirtualFileSystem(dataFile);
  const entries = await files.list('/');
  assert.deepEqual(entries.map((entry) => entry.name), ['Desktop', 'Documents', 'Downloads', 'Pictures']);

  await Promise.all([
    files.write('/Documents/first.txt', 'first'),
    files.write('/Documents/second.txt', 'second')
  ]);
  assert.equal(await files.read('/Documents/first.txt'), 'first');
  assert.equal(await files.read('/Documents/second.txt'), 'second');
});

test('persists nested files through a rename and recursive delete', async () => {
  const files = new VirtualFileSystem(dataFile);
  await files.mkdir('/Documents/Notes');
  await files.write('/Documents/Notes/todo.txt', 'remember Aether');

  const restartedFiles = new VirtualFileSystem(dataFile);
  assert.equal(await restartedFiles.read('/Documents/Notes/todo.txt'), 'remember Aether');
  assert.equal(await restartedFiles.rename('/Documents/Notes', 'Archive'), '/Documents/Archive');
  assert.equal(await restartedFiles.read('/Documents/Archive/todo.txt'), 'remember Aether');
  await restartedFiles.delete('/Documents/Archive');
  await assert.rejects(restartedFiles.read('/Documents/Archive/todo.txt'), /File not found/);
});

test('rejects paths outside the virtual filesystem and root deletion', async () => {
  const files = new VirtualFileSystem(dataFile);
  await assert.rejects(files.list('/../../outside'), /cannot leave the virtual filesystem/);
  await assert.rejects(files.delete('/'), /Item not found/);
  await assert.rejects(files.write('/Missing/file.txt', 'no parent'), /parent folder does not exist/);
});

test('reports corrupted persistent data instead of silently resetting it', async () => {
  const badFile = path.join(dataDirectory, 'corrupted.json');
  await fs.writeFile(badFile, '{broken', 'utf8');
  const files = new VirtualFileSystem(badFile);
  await assert.rejects(files.list('/'), SyntaxError);
});
