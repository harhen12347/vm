const fs = require('node:fs/promises');
const path = require('node:path');

const folders = ['Desktop', 'Documents', 'Downloads', 'Pictures'];

class VirtualFileSystem {
  constructor(filePath) {
    this.filePath = filePath;
    this.operationQueue = Promise.resolve();
  }

  cleanPath(input = '/') {
    const parts = String(input).replaceAll('\\', '/').split('/').filter(Boolean);
    if (parts.some((part) => part === '..')) throw new Error('Path cannot leave the virtual filesystem.');
    return `/${parts.filter((part) => part !== '.').join('/')}`;
  }

  async load() {
    try {
      const data = JSON.parse(await fs.readFile(this.filePath, 'utf8'));
      if (!data || typeof data.entries !== 'object' || !data.entries || !data.entries['/']) {
        throw new Error('Virtual filesystem data is invalid.');
      }
      return data;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }

    const entries = { '/': { type: 'folder', modified: Date.now() } };
    for (const name of folders) {
      entries[`/${name}`] = { type: 'folder', modified: Date.now() };
    }
    entries['/Documents/Welcome.txt'] = {
      type: 'file',
      content: 'Welcome to Aether Desktop!\n\nYour files live in a virtual filesystem and persist on this device.',
      modified: Date.now()
    };
    return { entries };
  }

  async save(data) {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const tempFile = `${this.filePath}.tmp`;
    await fs.writeFile(tempFile, JSON.stringify(data), 'utf8');
    await fs.rename(tempFile, this.filePath);
  }

  mutate(action) {
    const operation = this.operationQueue.then(async () => {
      const data = await this.load();
      const result = await action(data.entries);
      await this.save(data);
      return result;
    });
    this.operationQueue = operation.catch(() => {});
    return operation;
  }

  async list(input = '/') {
    const folderPath = this.cleanPath(input);
    await this.operationQueue;
    const entries = (await this.load()).entries;
    if (!entries[folderPath] || entries[folderPath].type !== 'folder') throw new Error('Folder not found.');
    const prefix = folderPath === '/' ? '/' : `${folderPath}/`;
    return Object.entries(entries)
      .filter(([name]) => name.startsWith(prefix) && name !== folderPath && !name.slice(prefix.length).includes('/'))
      .map(([name, entry]) => ({ name: path.posix.basename(name), path: name, ...entry }))
      .sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'folder' ? -1 : 1);
  }

  async read(input) {
    const virtualPath = this.cleanPath(input);
    await this.operationQueue;
    const entry = (await this.load()).entries[virtualPath];
    if (!entry || entry.type !== 'file') throw new Error('File not found.');
    return entry.content;
  }

  write(input, content) {
    return this.mutate((entries) => {
      const virtualPath = this.cleanPath(input);
      this.assertParentFolder(entries, virtualPath);
      if (entries[virtualPath] && entries[virtualPath].type !== 'file') throw new Error('A folder already exists at that path.');
      entries[virtualPath] = { type: 'file', content: String(content), modified: Date.now() };
      return true;
    });
  }

  mkdir(input) {
    return this.mutate((entries) => {
      const virtualPath = this.cleanPath(input);
      if (virtualPath === '/') throw new Error('The root folder already exists.');
      this.assertParentFolder(entries, virtualPath);
      if (entries[virtualPath]) throw new Error('An item with that name already exists.');
      entries[virtualPath] = { type: 'folder', modified: Date.now() };
      return true;
    });
  }

  rename(input, newName) {
    return this.mutate((entries) => {
      const oldPath = this.cleanPath(input);
      const name = String(newName).trim();
      if (!name || name === '.' || name === '..' || /[\\/]/.test(name)) throw new Error('Enter a valid name.');
      const newPath = path.posix.join(path.posix.dirname(oldPath), name);
      if (!entries[oldPath] || oldPath === '/') throw new Error('Item not found.');
      if (entries[newPath]) throw new Error('An item with that name already exists.');
      for (const [currentPath, entry] of Object.entries(entries)) {
        if (currentPath === oldPath || currentPath.startsWith(`${oldPath}/`)) {
          entries[newPath + currentPath.slice(oldPath.length)] = { ...entry, modified: Date.now() };
          delete entries[currentPath];
        }
      }
      return newPath;
    });
  }

  delete(input) {
    return this.mutate((entries) => {
      const virtualPath = this.cleanPath(input);
      if (!entries[virtualPath] || virtualPath === '/') throw new Error('Item not found.');
      for (const currentPath of Object.keys(entries)) {
        if (currentPath === virtualPath || currentPath.startsWith(`${virtualPath}/`)) delete entries[currentPath];
      }
      return true;
    });
  }

  assertParentFolder(entries, virtualPath) {
    const parent = path.posix.dirname(virtualPath);
    if (!entries[parent] || entries[parent].type !== 'folder') throw new Error('The parent folder does not exist.');
  }
}

module.exports = { VirtualFileSystem };
