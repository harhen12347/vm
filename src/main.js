const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('node:path');
const os = require('node:os');
const { VirtualFileSystem } = require('./vfs');

function registerFileSystemHandlers(files) {
  ipcMain.handle('fs:list', (_event, input) => files.list(input));
  ipcMain.handle('fs:read', (_event, input) => files.read(input));
  ipcMain.handle('fs:write', (_event, input, content) => files.write(input, content));
  ipcMain.handle('fs:mkdir', (_event, input) => files.mkdir(input));
  ipcMain.handle('fs:rename', (_event, input, newName) => files.rename(input, newName));
  ipcMain.handle('fs:delete', (_event, input) => files.delete(input));
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 760,
    minHeight: 540,
    backgroundColor: '#0b1020',
    title: 'Aether Desktop',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true
    }
  });

  win.loadFile(path.join(__dirname, 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  const files = new VirtualFileSystem(path.join(app.getPath('userData'), 'aether-files.json'));
  registerFileSystemHandlers(files);
  ipcMain.handle('system:info', () => ({
    platform: os.platform(),
    release: os.release(),
    cpuCount: os.cpus().length,
    cpuTimes: os.cpus().map((cpu) => cpu.times),
    totalMemory: os.totalmem(),
    freeMemory: os.freemem(),
    appVersion: app.getVersion()
  }));
  ipcMain.handle('system:quit', () => app.quit());
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
