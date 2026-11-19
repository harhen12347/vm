const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('aether', {
  files: {
    list: (folderPath) => ipcRenderer.invoke('fs:list', folderPath),
    read: (filePath) => ipcRenderer.invoke('fs:read', filePath),
    write: (filePath, content) => ipcRenderer.invoke('fs:write', filePath, content),
    mkdir: (folderPath) => ipcRenderer.invoke('fs:mkdir', folderPath),
    rename: (filePath, name) => ipcRenderer.invoke('fs:rename', filePath, name),
    delete: (filePath) => ipcRenderer.invoke('fs:delete', filePath)
  },
  system: {
    info: () => ipcRenderer.invoke('system:info'),
    quit: () => ipcRenderer.invoke('system:quit')
  }
});
