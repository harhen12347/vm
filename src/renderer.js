const apps = [
  { id: 'files', name: 'File Explorer', icon: '▰', cls: 'files', width: 820, height: 535 },
  { id: 'browser', name: 'Aether Browser', icon: '◉', cls: 'browser', width: 1040, height: 680 },
  { id: 'calculator', name: 'Calculator', icon: '▦', cls: 'calc', width: 360, height: 485 },
  { id: 'notepad', name: 'Notepad', icon: '▤', cls: 'notes', width: 650, height: 490 },
  { id: 'terminal', name: 'Terminal', icon: '>_', cls: 'terminal', width: 700, height: 440 },
  { id: 'settings', name: 'Settings', icon: '⚙', cls: 'settings', width: 760, height: 555 },
  { id: 'paint', name: 'Paint', icon: '◒', cls: 'paint', width: 820, height: 560 },
  { id: 'manager', name: 'Task Manager', icon: '▥', cls: 'manager', width: 650, height: 510 },
  { id: 'store', name: 'App Store', icon: '▣', cls: 'store', width: 720, height: 550 }
];

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
if (!window.aether) {
  const request = async (url, options) => {
    const response = await fetch(url, options);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Request failed (${response.status}).`);
    return result;
  };
  const post = (url, body) => request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  window.aether = {
    files: {
      list: (folderPath) => request(`/api/files/list?path=${encodeURIComponent(folderPath)}`),
      read: async (filePath) => (await request(`/api/files/read?path=${encodeURIComponent(filePath)}`)).content,
      write: (filePath, content) => post('/api/files/write', { path: filePath, content }),
      mkdir: (folderPath) => post('/api/files/mkdir', { path: folderPath }),
      rename: async (filePath, name) => (await post('/api/files/rename', { path: filePath, name })).path,
      delete: (filePath) => post('/api/files/delete', { path: filePath })
    },
    system: { info: () => request('/api/system') }
  };
}
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[char]);
const windows = new Map();
let activeWindow = null;
let windowSequence = 0;
let zIndex = 3;
let currentUser = localStorage.getItem('aether-user') || 'Alex Morgan';

function appIcon(app, additionalClass = '') {
  return `<span class="app-icon ${app.cls} ${additionalClass}">${app.icon}</span>`;
}

function showToast(message, isError = false) {
  $$('.toast').forEach((toast) => toast.remove());
  const toast = document.createElement('div');
  toast.className = `toast${isError ? ' error' : ''}`;
  toast.textContent = message;
  $('#desktop').append(toast);
  setTimeout(() => toast.remove(), 3000);
}

function formatTime(date = new Date()) {
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function updateClock() {
  const now = new Date();
  $('#clock-time').textContent = formatTime(now);
  $('#clock-date').textContent = now.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

function buildShortcuts() {
  const shortcutApps = ['files', 'browser', 'calculator', 'notepad', 'terminal', 'settings', 'paint', 'manager', 'store'];
  $('#desktop-shortcuts').innerHTML = shortcutApps.map((id) => {
    const app = apps.find((item) => item.id === id);
    return `<button class="desktop-shortcut" data-launch="${app.id}">${appIcon(app)}<span>${app.name}</span></button>`;
  }).join('');

  $('#start-apps').innerHTML = apps.map((app) =>
    `<button class="start-app" data-launch="${app.id}">${appIcon(app)}<span>${app.name}</span></button>`
  ).join('');

  $('#taskbar-pins').innerHTML = ['files', 'browser', 'calculator', 'notepad', 'settings'].map((id) => {
    const app = apps.find((item) => item.id === id);
    return `<button class="pin-button" data-launch="${id}" title="${app.name}">${appIcon(app)}</button>`;
  }).join('');
}

function togglePanel(panelId, force) {
  const panel = $(`#${panelId}`);
  const open = force ?? panel.classList.contains('hidden');
  ['start-menu', 'notification-panel', 'power-menu'].forEach((id) => {
    if (id !== panelId) $(`#${id}`).classList.add('hidden');
  });
  panel.classList.toggle('hidden', !open);
  if (open && panelId === 'start-menu') $('#app-search').focus();
}

function makeWindow(app, options = {}) {
  const id = `window-${++windowSequence}`;
  const win = document.createElement('section');
  win.className = 'app-window';
  win.dataset.windowId = id;
  win.dataset.appId = app.id;
  const offset = (windowSequence - 1) % 8;
  const width = Math.min(app.width, Math.max(360, innerWidth - 36));
  const height = Math.min(app.height, Math.max(260, innerHeight - 92));
  win.style.width = `${width}px`;
  win.style.height = `${height}px`;
  win.style.left = `${Math.max(14, (innerWidth - width) / 2 + offset * 23)}px`;
  win.style.top = `${Math.max(12, (innerHeight - height - 66) / 2 + offset * 19)}px`;
  win.innerHTML = `
    <header class="window-titlebar">
      <div class="window-title">${appIcon(app)}<span>${escapeHtml(options.title || app.name)}</span></div>
      <div class="window-controls">
        <button data-window-minimize title="Minimize">—</button>
        <button data-window-maximize title="Maximize">□</button>
        <button class="close-window" data-window-close title="Close">×</button>
      </div>
    </header>
    <div class="window-content"></div>`;
  $('#windows-layer').append(win);
  const instance = {
    id, app, element: win, content: $('.window-content', win), options,
    title: options.title || app.name, minimized: false
  };
  windows.set(id, instance);
  win.addEventListener('pointerdown', () => focusWindow(id));
  win.querySelector('[data-window-close]').addEventListener('click', () => closeWindow(id));
  win.querySelector('[data-window-minimize]').addEventListener('click', () => minimizeWindow(id));
  win.querySelector('[data-window-maximize]').addEventListener('click', () => maximizeWindow(id));
  makeDraggable(win);
  focusWindow(id);
  addRunningButton(instance);
  return instance;
}

function addRunningButton(instance) {
  const button = document.createElement('button');
  button.className = 'running-app';
  button.title = instance.title;
  button.dataset.runningWindow = instance.id;
  button.innerHTML = appIcon(instance.app);
  button.addEventListener('click', () => {
    if (instance.minimized) {
      instance.minimized = false;
      instance.element.classList.remove('hidden');
      focusWindow(instance.id);
    } else if (activeWindow === instance.id) {
      minimizeWindow(instance.id);
    } else {
      focusWindow(instance.id);
    }
  });
  $('#running-apps').append(button);
}

function focusWindow(id) {
  const instance = windows.get(id);
  if (!instance) return;
  activeWindow = id;
  instance.element.style.zIndex = String(++zIndex);
  $$('.running-app').forEach((button) => button.classList.toggle('active', button.dataset.runningWindow === id));
}

async function closeWindow(id) {
  const instance = windows.get(id);
  if (!instance) return;
  if (instance.autoSaveTimer) clearTimeout(instance.autoSaveTimer);
  if (instance.statsTimer) clearInterval(instance.statsTimer);
  if (instance.flush) {
    try { await instance.flush(); }
    catch (error) { showToast(`Could not save your file: ${error.message}`, true); }
  }
  if (instance.app.id === 'browser') {
    $$('.browser-tab', instance.content).forEach((tab) => tab.webview?.remove());
  }
  instance.element.remove();
  $(`[data-running-window="${id}"]`)?.remove();
  windows.delete(id);
  if (activeWindow === id) {
    activeWindow = null;
    const lastWindow = [...windows.values()].at(-1);
    if (lastWindow) focusWindow(lastWindow.id);
  }
}

function minimizeWindow(id) {
  const instance = windows.get(id);
  if (!instance) return;
  instance.minimized = true;
  instance.element.classList.add('hidden');
  if (activeWindow === id) {
    activeWindow = null;
    const lastWindow = [...windows.values()].filter((item) => !item.minimized).at(-1);
    if (lastWindow) focusWindow(lastWindow.id);
  }
  $(`[data-running-window="${id}"]`)?.classList.remove('active');
}

function maximizeWindow(id) {
  const instance = windows.get(id);
  if (!instance) return;
  const win = instance.element;
  if (win.classList.toggle('maximized')) {
    win.dataset.previousPosition = JSON.stringify({
      left: win.style.left, top: win.style.top, width: win.style.width, height: win.style.height
    });
    win.style.left = '';
    win.style.top = '';
    win.style.width = '';
    win.style.height = '';
  } else {
    const previous = JSON.parse(win.dataset.previousPosition || '{}');
    Object.assign(win.style, previous);
  }
}

function makeDraggable(win) {
  const bar = $('.window-titlebar', win);
  bar.addEventListener('pointerdown', (event) => {
    if (event.target.closest('.window-controls') || win.classList.contains('maximized')) return;
    const startX = event.clientX;
    const startY = event.clientY;
    const startLeft = win.offsetLeft;
    const startTop = win.offsetTop;
    bar.setPointerCapture(event.pointerId);
    const move = (moveEvent) => {
      win.style.left = `${Math.max(0, Math.min(innerWidth - 100, startLeft + moveEvent.clientX - startX))}px`;
      win.style.top = `${Math.max(0, Math.min(innerHeight - 100, startTop + moveEvent.clientY - startY))}px`;
    };
    const end = () => {
      bar.removeEventListener('pointermove', move);
      bar.removeEventListener('pointerup', end);
    };
    bar.addEventListener('pointermove', move);
    bar.addEventListener('pointerup', end);
  });
  bar.addEventListener('dblclick', (event) => {
    if (!event.target.closest('.window-controls')) maximizeWindow(win.dataset.windowId);
  });
}

function launchApp(id, options = {}) {
  togglePanel('start-menu', false);
  const app = apps.find((item) => item.id === id);
  if (!app) return;
  const win = makeWindow(app, options);
  const renderers = {
    files: renderFiles, browser: renderBrowser, calculator: renderCalculator,
    notepad: renderNotepad, terminal: renderTerminal, settings: renderSettings,
    paint: renderPaint, manager: renderTaskManager, store: renderStore
  };
  renderers[id](win);
}

function safePath(parent, child) {
  if (child.startsWith('/')) return child;
  const stack = parent.split('/').filter(Boolean);
  for (const part of child.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (stack.length) stack.pop();
    } else stack.push(part);
  }
  return `/${stack.join('/')}`;
}

function renderFiles(win) {
  const startingPath = win.options.path || '/';
  win.state = { path: startingPath, selected: null };
  win.content.innerHTML = `
    <div class="app-toolbar">
      <button data-file-back title="Up one folder">←</button>
      <input class="path-field" data-file-path aria-label="Folder path">
      <button data-file-new-folder>New folder</button>
      <button data-file-new-file>New file</button>
      <button data-file-rename>Rename</button>
      <button data-file-delete>Delete</button>
    </div>
    <div class="file-layout">
      <nav class="file-sidebar">${['Desktop', 'Documents', 'Downloads', 'Pictures'].map((name) =>
        `<button class="file-nav" data-folder="/${name}"><span>◫</span>${name}</button>`
      ).join('')}<button class="file-nav" data-folder="/"><span>⌂</span>This device</button></nav>
      <div class="file-list-area"><div class="file-columns"><span>Name</span><span>Type</span></div><div class="file-entries"></div></div>
    </div>`;
  const list = $('.file-entries', win.content);
  const input = $('[data-file-path]', win.content);

  const load = async (targetPath = win.state.path) => {
    try {
      const entries = await window.aether.files.list(targetPath);
      win.state.path = targetPath;
      win.state.selected = null;
      input.value = targetPath;
      $$('[data-folder]', win.content).forEach((button) => button.classList.toggle('selected', button.dataset.folder === targetPath));
      list.innerHTML = entries.length ? entries.map((entry) => `
        <button class="file-row" data-file-path-item="${escapeHtml(entry.path)}" data-kind="${entry.type}">
          <span class="file-name"><span>${entry.type === 'folder' ? '📁' : (entry.name.toLowerCase().endsWith('.png') ? '🖼' : '▤')}</span>${escapeHtml(entry.name)}</span>
          <span class="file-type">${entry.type === 'folder' ? 'Folder' : 'File'}</span>
        </button>`).join('') : '<div class="empty-folder">This folder is empty.</div>';
    } catch (error) {
      showToast(error.message, true);
    }
  };

  const createFolder = async () => {
    const name = prompt('Name for the new folder:');
    if (!name) return;
    try { await window.aether.files.mkdir(safePath(win.state.path, name)); await load(); }
    catch (error) { showToast(error.message, true); }
  };
  const createFile = async () => {
    const name = prompt('Name for the new file:', 'New file.txt');
    if (!name) return;
    try {
      const filePath = safePath(win.state.path, name);
      await window.aether.files.write(filePath, '');
      await load();
      await openTextFile(filePath);
    } catch (error) { showToast(error.message, true); }
  };

  win.content.addEventListener('click', async (event) => {
    const folder = event.target.closest('[data-folder]');
    if (folder) return load(folder.dataset.folder);
    const row = event.target.closest('[data-file-path-item]');
    if (!row) return;
    $$('.file-row', win.content).forEach((item) => item.classList.toggle('selected', item === row));
    win.state.selected = row.dataset.filePathItem;
    if (event.detail > 1) {
      if (row.dataset.kind === 'folder') load(row.dataset.filePathItem);
      else if (row.dataset.filePathItem.toLowerCase().endsWith('.png')) openPaintFile(row.dataset.filePathItem);
      else openTextFile(row.dataset.filePathItem);
    }
  });
  $('[data-file-back]', win.content).addEventListener('click', () => load(win.state.path === '/' ? '/' : safePath(win.state.path, '..')));
  $('[data-file-new-folder]', win.content).addEventListener('click', createFolder);
  $('[data-file-new-file]', win.content).addEventListener('click', createFile);
  $('[data-file-rename]', win.content).addEventListener('click', async () => {
    if (!win.state.selected) return showToast('Select an item to rename.');
    const currentName = win.state.selected.split('/').at(-1);
    const name = prompt('New name:', currentName);
    if (!name) return;
    try { await window.aether.files.rename(win.state.selected, name); await load(); }
    catch (error) { showToast(error.message, true); }
  });
  $('[data-file-delete]', win.content).addEventListener('click', async () => {
    if (!win.state.selected) return showToast('Select an item to delete.');
    if (!confirm(`Delete "${win.state.selected.split('/').at(-1)}"?`)) return;
    try { await window.aether.files.delete(win.state.selected); await load(); }
    catch (error) { showToast(error.message, true); }
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') load(input.value.startsWith('/') ? input.value : safePath(win.state.path, input.value));
  });
  load();
}

function openTextFile(filePath) {
  window.aether.files.read(filePath).then((content) => launchApp('notepad', {
    title: filePath.split('/').at(-1), path: filePath, content
  })).catch((error) => showToast(error.message, true));
}

function renderNotepad(win) {
  const filePath = win.options.path || null;
  win.content.innerHTML = `
    <div class="notepad">
      <div class="notepad-menu"><button data-note-new>File</button><button data-note-save>Save</button><span data-note-status>${filePath ? escapeHtml(filePath) : 'Untitled'}</span></div>
      <textarea spellcheck="false" aria-label="Document text"></textarea>
      <div class="status-line"><span data-note-count>Ln 1, Col 1</span></div>
    </div>`;
  const editor = $('textarea', win.content);
  const label = $('[data-note-status]', win.content);
  const count = $('[data-note-count]', win.content);
  editor.value = win.options.content || '';
  const updateCount = () => {
    const beforeCursor = editor.value.slice(0, editor.selectionStart);
    const lines = beforeCursor.split('\n');
    count.textContent = `Ln ${lines.length}, Col ${lines.at(-1).length + 1}  ·  ${editor.value.length} characters`;
  };
  const save = async (saveAs = false, notify = true) => {
    let destination = win.options.path;
    if (!destination || saveAs) {
      const suggestedName = win.title === 'Notepad' ? 'Untitled.txt' : win.title;
      const name = prompt('Save file name (in Documents):', suggestedName);
      if (!name) return;
      destination = name.startsWith('/') ? name : `/Documents/${name}`;
    }
    try {
      await window.aether.files.write(destination, editor.value);
      win.options.path = destination;
      win.title = destination.split('/').at(-1);
      $('.window-title span:last-child', win.element).textContent = win.title;
      label.textContent = destination;
      if (notify) showToast('File saved.');
    } catch (error) { showToast(error.message, true); }
  };
  win.flush = () => win.options.path ? save(false, false) : undefined;
  editor.addEventListener('input', () => {
    updateCount();
    if (win.options.path) {
      clearTimeout(win.autoSaveTimer);
      win.autoSaveTimer = setTimeout(() => save(), 450);
    }
  });
  editor.addEventListener('keyup', updateCount);
  editor.addEventListener('click', updateCount);
  $('[data-note-save]', win.content).addEventListener('click', () => save());
  $('[data-note-new]', win.content).addEventListener('click', () => {
    if (editor.value && confirm('Save this document before creating another?')) save();
    editor.value = '';
    win.options.path = null;
    win.title = 'Notepad';
    label.textContent = 'Untitled';
    $('.window-title span:last-child', win.element).textContent = 'Notepad';
    updateCount();
  });
  editor.focus();
}

function evaluateMath(source, variables = {}) {
  const tokens = source.match(/\s*(?:(\d+(?:\.\d*)?|\.\d+)|([a-zA-Z_]\w*)|(\*\*|[()+\-*/%]))/g);
  if (!tokens || tokens.join('').trim() !== source.trim()) throw new Error('Use numbers and +, -, *, /, %, **, and parentheses.');
  const values = tokens.map((token) => token.trim()).filter(Boolean);
  let position = 0;
  const peek = () => values[position];
  const consume = () => values[position++];
  const atom = () => {
    if (peek() === '+' || peek() === '-') {
      const sign = consume();
      const value = atom();
      return sign === '-' ? -value : value;
    }
    if (peek() === '(') {
      consume();
      const value = expression();
      if (consume() !== ')') throw new Error('Missing closing parenthesis.');
      return value;
    }
    const token = consume();
    if (!token) throw new Error('Enter an expression.');
    if (/^(?:\d|\.)/.test(token)) return Number(token);
    if (token.toLowerCase() === 'pi') return Math.PI;
    if (token.toLowerCase() === 'e') return Math.E;
    if (Object.hasOwn(variables, token)) return Number(variables[token]);
    throw new Error(`Unknown value: ${token}`);
  };
  const power = () => {
    const left = atom();
    if (peek() === '**') {
      consume();
      return left ** unary();
    }
    return left;
  };
  const unary = () => {
    if (peek() === '+' || peek() === '-') {
      const sign = consume();
      const value = unary();
      return sign === '-' ? -value : value;
    }
    return power();
  };
  const product = () => {
    let value = unary();
    while (['*', '/', '%'].includes(peek())) {
      const operator = consume();
      const right = unary();
      if (operator === '*') value *= right;
      if (operator === '/') value /= right;
      if (operator === '%') value %= right;
    }
    return value;
  };
  const expression = () => {
    let value = product();
    while (peek() === '+' || peek() === '-') {
      const operator = consume();
      const right = product();
      value = operator === '+' ? value + right : value - right;
    }
    return value;
  };
  const result = expression();
  if (position !== values.length) throw new Error(`Unexpected token: ${peek()}`);
  if (!Number.isFinite(result)) throw new Error('The result is not a finite number.');
  return result;
}

function renderCalculator(win) {
  win.state = { expression: '', result: '0' };
  const keys = ['C', '±', '%', '÷', '7', '8', '9', '×', '4', '5', '6', '−', '1', '2', '3', '+', '⌫', '0', '.', '='];
  win.content.innerHTML = `
    <div class="calculator">
      <div class="calc-display"><div class="calc-expression" data-calc-expression></div><div class="calc-result" data-calc-result>0</div></div>
      <div class="calc-grid">${keys.map((key) => `<button class="${['÷', '×', '−', '+', '%'].includes(key) ? 'operator' : ''} ${key === '=' ? 'equals' : ''}" data-calc-key="${key}">${key}</button>`).join('')}</div>
    </div>`;
  const paint = () => {
    $('[data-calc-expression]', win.content).textContent = win.state.expression;
    $('[data-calc-result]', win.content).textContent = win.state.result;
  };
  const calculate = () => {
    const expression = win.state.expression.replaceAll('×', '*').replaceAll('÷', '/').replaceAll('−', '-');
    win.state.result = String(evaluateMath(expression));
  };
  win.content.addEventListener('click', (event) => {
    const button = event.target.closest('[data-calc-key]');
    if (!button) return;
    const key = button.dataset.calcKey;
    try {
      if (key === 'C') { win.state.expression = ''; win.state.result = '0'; }
      else if (key === '⌫') win.state.expression = win.state.expression.slice(0, -1);
      else if (key === '±') {
        if (win.state.expression) win.state.expression = `-(${win.state.expression})`;
      } else if (key === '=') {
        calculate();
        win.state.expression = win.state.result;
      } else win.state.expression += key;
      if (key !== '=' && key !== 'C' && key !== '⌫' && key !== '±') calculate();
      paint();
    } catch {
      win.state.result = '…';
      paint();
    }
  });
  win.content.addEventListener('keydown', (event) => {
    if (/^[\d.+\-*/%()]$/.test(event.key)) {
      win.state.expression += event.key;
      try { calculate(); } catch { win.state.result = '…'; }
      paint();
    } else if (event.key === 'Enter') {
      try { calculate(); win.state.expression = win.state.result; paint(); } catch (error) { showToast(error.message); }
    } else if (event.key === 'Backspace') {
      win.state.expression = win.state.expression.slice(0, -1);
      try { calculate(); } catch { win.state.result = '0'; }
      paint();
    }
  });
  win.element.tabIndex = 0;
}

function renderBrowser(win) {
  win.state = { tabs: [], active: null };
  win.content.innerHTML = `
    <div class="browser-shell">
      <div class="browser-tabs" style="height:36px;display:flex;align-items:center;gap:4px;padding:4px 8px;background:#ffffff06;border-bottom:1px solid var(--line)">
        <div class="browser-tab-strip" style="flex:1;display:flex;gap:4px;overflow:auto"></div>
        <button data-tab-add title="New tab" style="width:28px;height:27px;border:0;border-radius:6px;background:#ffffff0b">+</button>
      </div>
      <div class="browser-toolbar app-toolbar">
        <button data-browser-back title="Back">←</button><button data-browser-forward title="Forward">→</button>
        <button data-browser-refresh title="Refresh">⟳</button><button data-browser-home title="Google home">⌂</button>
        <input class="browser-address" data-browser-address aria-label="Website or search" placeholder="Search Google or enter a URL">
        <button data-browser-go>Go</button><button data-browser-external title="If this page blocks embedding, open it in your regular browser">↗</button>
      </div>
      <div class="browser-page" style="position:relative;height:calc(100% - 83px);background:white">
        <div data-browser-empty style="display:grid;place-items:center;height:100%;color:#526079;font:13px 'DM Sans',sans-serif">
          <div style="text-align:center"><div style="font-size:38px;margin-bottom:12px;color:#7789d9">◉</div><b style="font-size:21px">Browse freely.</b><p>Real Chromium browsing · Search with Google</p></div>
        </div>
      </div>
    </div>`;
  const strip = $('.browser-tab-strip', win.content);
  const page = $('.browser-page', win.content);
  const address = $('[data-browser-address]', win.content);
  const isElectronBrowser = typeof document.createElement('webview').loadURL === 'function';

  const loadWebPage = (tab, url) => {
    tab.url = url;
    tab.page.src = url;
    $('.browser-tab-title', tab.button).textContent = new URL(url).hostname;
    tab.button.title = url;
    if (win.state.active === tab.id) address.value = url;
  };

  const go = (tab, query) => {
    const text = query.trim();
    if (!text) return;
    let url;
    try {
      const candidate = new URL(text.includes('://') ? text : `https://${text}`);
      if (candidate.protocol === 'https:' || candidate.protocol === 'http:') url = candidate.href;
    } catch { /* Treat non-URL input as a search. */ }
    if (!url) url = `https://www.google.com/search?q=${encodeURIComponent(text)}`;
    if (isElectronBrowser) {
      if (!tab.webview) createTab(url, tab.id);
      else tab.webview.loadURL(url);
      address.value = url;
    } else {
      tab.history = tab.history.slice(0, tab.historyIndex + 1);
      tab.history.push(url);
      tab.historyIndex = tab.history.length - 1;
      loadWebPage(tab, url);
    }
  };

  const createTab = (url = '', activate = true) => {
    const tabId = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const tabButton = document.createElement('button');
    tabButton.className = 'browser-tab';
    tabButton.dataset.tab = tabId;
    tabButton.style.cssText = 'height:27px;min-width:105px;max-width:180px;flex:1;display:flex;align-items:center;justify-content:space-between;gap:5px;padding:0 7px;border:1px solid var(--line);border-radius:6px;background:#ffffff0b;color:inherit;font-size:10px';
    tabButton.innerHTML = `<span class="browser-tab-title" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">New tab</span><span data-tab-close="${tabId}" style="font-size:14px">×</span>`;
    const webview = isElectronBrowser ? document.createElement('webview') : null;
    const pageElement = isElectronBrowser ? webview : document.createElement('iframe');
    if (webview) {
      webview.setAttribute('partition', 'persist:aether-browser');
      webview.setAttribute('allowpopups', '');
      webview.setAttribute('webpreferences', 'contextIsolation=yes, nodeIntegration=no, sandbox=yes');
      webview.style.cssText = 'width:100%;height:100%;display:none;background:white';
    } else {
      pageElement.title = 'Web page';
      pageElement.setAttribute('sandbox', 'allow-forms allow-scripts allow-downloads');
      pageElement.referrerPolicy = 'strict-origin-when-cross-origin';
      pageElement.style.cssText = 'width:100%;height:100%;display:none;border:0;background:white';
    }
    page.append(pageElement);
    const tab = {
      id: tabId, webview, page: pageElement, button: tabButton, title: 'New tab',
      url: '', history: [], historyIndex: -1
    };
    win.state.tabs.push(tab);
    strip.append(tabButton);
    tabButton.addEventListener('click', (event) => {
      if (event.target.closest('[data-tab-close]')) {
        closeTab(tabId);
        return;
      }
      selectTab(tabId);
    });
    if (webview) {
      webview.addEventListener('did-navigate', () => {
        if (win.state.active === tabId) address.value = webview.getURL();
        tab.url = webview.getURL();
      });
      webview.addEventListener('did-navigate-in-page', () => {
        if (win.state.active === tabId) address.value = webview.getURL();
        tab.url = webview.getURL();
      });
      webview.addEventListener('page-title-updated', (event) => {
        tab.title = event.title || 'New tab';
        $('.browser-tab-title', tabButton).textContent = tab.title;
        tabButton.title = tab.title;
      });
      webview.addEventListener('did-fail-load', (event) => {
        if (event.errorCode !== -3) showToast(`Could not load page: ${event.errorDescription}`, true);
      });
      webview.addEventListener('dom-ready', () => {
        webview.insertCSS('html { scroll-behavior: smooth; }').catch(() => {});
      });
    }
    selectTab(tabId);
    if (url) go(tab, url);
    return tab;
  };

  const selectTab = (tabId) => {
    const tab = win.state.tabs.find((item) => item.id === tabId);
    if (!tab) return;
    win.state.active = tabId;
    for (const current of win.state.tabs) {
      current.button.style.background = current.id === tabId ? '#ffffff1b' : '#ffffff08';
      current.page.style.display = current.id === tabId ? 'block' : 'none';
    }
    $('[data-browser-empty]', win.content).style.display = tab.url ? 'none' : 'grid';
    address.value = tab.webview ? tab.url : tab.url;
  };

  const closeTab = (tabId) => {
    const index = win.state.tabs.findIndex((tab) => tab.id === tabId);
    if (index < 0) return;
    const [tab] = win.state.tabs.splice(index, 1);
    tab.page.remove();
    tab.button.remove();
    if (!win.state.tabs.length) return createTab();
    if (win.state.active === tabId) selectTab(win.state.tabs[Math.max(0, index - 1)].id);
  };

  const currentTab = () => win.state.tabs.find((tab) => tab.id === win.state.active);
  $('[data-tab-add]', win.content).addEventListener('click', () => createTab());
  $('[data-browser-go]', win.content).addEventListener('click', () => go(currentTab(), address.value));
  address.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') go(currentTab(), address.value);
  });
  $('[data-browser-back]', win.content).addEventListener('click', () => {
    const tab = currentTab();
    if (tab?.webview && tab.webview.canGoBack()) tab.webview.goBack();
    else if (tab?.historyIndex > 0) loadWebPage(tab, tab.history[--tab.historyIndex]);
  });
  $('[data-browser-forward]', win.content).addEventListener('click', () => {
    const tab = currentTab();
    if (tab?.webview && tab.webview.canGoForward()) tab.webview.goForward();
    else if (tab && tab.historyIndex < tab.history.length - 1) loadWebPage(tab, tab.history[++tab.historyIndex]);
  });
  $('[data-browser-refresh]', win.content).addEventListener('click', () => {
    const tab = currentTab();
    if (tab?.webview) tab.webview.reload();
    else if (tab?.url) loadWebPage(tab, tab.url);
  });
  $('[data-browser-home]', win.content).addEventListener('click', () => go(currentTab(), 'https://www.google.com'));
  $('[data-browser-external]', win.content).addEventListener('click', () => {
    const tab = currentTab();
    if (tab?.url) window.open(tab.url, '_blank', 'noopener,noreferrer');
  });
  createTab('', true);
  $('[data-browser-empty]', win.content).style.display = 'grid';
}

function renderTerminal(win) {
  win.state = { cwd: '/', variables: {} };
  win.content.innerHTML = `
    <div class="terminal">
      <div class="terminal-output" data-terminal-output><div>✦ Aether Terminal · type <b>help</b> to see commands.</div></div>
      <label class="terminal-line"><span data-terminal-prompt></span><input data-terminal-input autocomplete="off" spellcheck="false" aria-label="Terminal command"></label>
    </div>`;
  const output = $('[data-terminal-output]', win.content);
  const input = $('[data-terminal-input]', win.content);
  const promptLabel = $('[data-terminal-prompt]', win.content);
  const updatePrompt = () => { promptLabel.textContent = `${currentUser.toLowerCase().split(' ')[0]}@aether:${win.state.cwd}$`; };
  const writeLine = (text = '') => {
    const line = document.createElement('div');
    line.textContent = text;
    output.append(line);
    output.scrollTop = output.scrollHeight;
  };
  const tokenize = (line) => {
    const matches = line.match(/"([^"]*)"|'([^']*)'|[^\s]+/g) || [];
    return matches.map((item) => item.replace(/^(?:"([^"]*)"|'([^']*)')$/, (_full, double, single) => double ?? single));
  };
  const execute = async (line) => {
    const args = tokenize(line.trim());
    if (!args.length) return;
    const [command, ...parts] = args;
    const argumentPath = (value) => {
      if (!value || value === '~') return '/';
      return safePath(win.state.cwd, value.replace(/^~\//, ''));
    };
    const listNames = async (folder) => (await window.aether.files.list(folder)).map((item) =>
      item.type === 'folder' ? `${item.name}/` : item.name
    ).join('  ');

    try {
      if (command === 'help') {
        writeLine('help · ls [path] · cd [path] · mkdir <name> · touch <file> · rm <path>');
        writeLine('clear · echo <text> [> file] · date · whoami · pwd · python [expression] · exit');
      } else if (command === 'ls') {
        writeLine(await listNames(argumentPath(parts[0] || '.')));
      } else if (command === 'cd') {
        const destination = argumentPath(parts[0] || '/');
        await window.aether.files.list(destination);
        win.state.cwd = destination;
        updatePrompt();
      } else if (command === 'pwd') {
        writeLine(win.state.cwd);
      } else if (command === 'mkdir') {
        if (!parts[0]) throw new Error('Usage: mkdir <folder>');
        await window.aether.files.mkdir(argumentPath(parts[0]));
      } else if (command === 'touch') {
        if (!parts[0]) throw new Error('Usage: touch <file>');
        const destination = argumentPath(parts[0]);
        try { await window.aether.files.read(destination); }
        catch { await window.aether.files.write(destination, ''); }
      } else if (command === 'rm') {
        if (!parts[0]) throw new Error('Usage: rm <path>');
        await window.aether.files.delete(argumentPath(parts[0]));
      } else if (command === 'clear') {
        output.innerHTML = '';
      } else if (command === 'date') {
        writeLine(new Date().toString());
      } else if (command === 'whoami') {
        writeLine(currentUser);
      } else if (command === 'echo') {
        const separator = parts.indexOf('>');
        if (separator >= 0) {
          if (!parts[separator + 1]) throw new Error('Usage: echo <text> > <file>');
          await window.aether.files.write(argumentPath(parts[separator + 1]), parts.slice(0, separator).join(' '));
        } else writeLine(parts.join(' '));
      } else if (command === 'python') {
        const source = parts.join(' ');
        if (!source) {
          writeLine('Aether Python mode evaluates arithmetic expressions, variables, and print(...).');
          writeLine('Try: python 6 * 7   |   python x = 12   |   python print(x)');
        } else {
          const printCall = source.match(/^print\((.*)\)$/);
          const assignment = source.match(/^([a-zA-Z_]\w*)\s*=\s*(.+)$/);
          if (printCall) {
            const text = printCall[1].trim().replace(/^(['"])(.*)\1$/, '$2');
            writeLine(Object.hasOwn(win.state.variables, text) ? String(win.state.variables[text]) :
              (text === 'True' ? 'True' : text === 'False' ? 'False' : text));
          } else if (assignment) {
            win.state.variables[assignment[1]] = evaluateMath(assignment[2], win.state.variables);
          } else {
            writeLine(String(evaluateMath(source, win.state.variables)));
          }
        }
      } else if (command === 'exit') {
        closeWindow(win.id);
        return;
      } else {
        throw new Error(`Command not found: ${command}. Type help to see available commands.`);
      }
    } catch (error) {
      writeLine(`Error: ${error.message}`);
    }
    output.scrollTop = output.scrollHeight;
  };
  input.addEventListener('keydown', async (event) => {
    if (event.key !== 'Enter') return;
    const command = input.value;
    writeLine(`${promptLabel.textContent} ${command}`);
    input.value = '';
    await execute(command);
  });
  win.content.addEventListener('click', () => input.focus());
  updatePrompt();
  input.focus();
}

function renderSettings(win) {
  const savedTheme = localStorage.getItem('aether-theme') || 'dark';
  document.body.classList.toggle('light-mode', savedTheme === 'light');
  win.content.innerHTML = `
    <div class="settings-layout">
      <nav class="settings-nav"><button class="active" data-settings-section="personal">Personalization</button>
        <button data-settings-section="system">System</button><button data-settings-section="about">About</button></nav>
      <div class="settings-content" data-settings-content></div>
    </div>`;
  const panel = $('[data-settings-content]', win.content);
  const sectionContent = {
    personal: `<h2>Personalization</h2><p>Make your workspace feel like yours.</p>
      <div class="setting-card"><div><b>Appearance</b><span>Choose your desktop theme.</span></div>
        <select data-theme><option value="dark">Dark</option><option value="light">Light</option></select></div>
      <div class="setting-card"><div><b>Desktop name</b><span>Change the name shown on your profile.</span></div><input data-profile type="text" maxlength="24"></div>
      <div class="setting-card"><div><b>Taskbar search</b><span>Show the search box on the taskbar.</span></div><button class="switch on" data-toggle-setting aria-label="Toggle taskbar search"></button></div>`,
    system: `<h2>System</h2><p>Manage how Aether behaves on this device.</p>
      <div class="setting-card"><div><b>Open app on sign in</b><span>Start at your desktop after sign in.</span></div><span>On this device</span></div>
      <div class="setting-card"><div><b>Virtual filesystem</b><span>Files are stored privately in this app's data folder.</span></div><button data-open-files>Open files</button></div>
      <div class="setting-card"><div><b>Power</b><span>Restart or shut down this desktop session.</span></div><button data-settings-power>Power options</button></div>`,
    about: `<h2>About Aether</h2><p>A calm, capable desktop for the web.</p>
      <div class="setting-card"><div><b>Aether Desktop</b><span>Version 1.0.0 · Electron desktop simulator</span></div><span>✦</span></div>
      <div class="setting-card"><div><b>Real web browsing</b><span>Powered by Chromium with HTTPS support.</span></div><span>Chromium</span></div>
      <div class="setting-card"><div><b>Persistent storage</b><span>Your virtual files are saved locally on this device.</span></div><span>Enabled</span></div>`
  };
  const showSection = (section) => {
    panel.innerHTML = sectionContent[section];
    $$('[data-settings-section]', win.content).forEach((button) => button.classList.toggle('active', button.dataset.settingsSection === section));
    const theme = $('[data-theme]', panel);
    if (theme) {
      theme.value = localStorage.getItem('aether-theme') || 'dark';
      theme.addEventListener('change', () => {
        localStorage.setItem('aether-theme', theme.value);
        document.body.classList.toggle('light-mode', theme.value === 'light');
      });
    }
    const profile = $('[data-profile]', panel);
    if (profile) {
      profile.value = currentUser;
      profile.addEventListener('change', () => {
        currentUser = profile.value.trim() || 'Alex Morgan';
        localStorage.setItem('aether-user', currentUser);
        $('#profile-label').textContent = currentUser;
        showToast('Profile updated.');
      });
    }
  };
  win.content.addEventListener('click', (event) => {
    const section = event.target.closest('[data-settings-section]');
    if (section) showSection(section.dataset.settingsSection);
    if (event.target.closest('[data-toggle-setting]')) event.target.closest('[data-toggle-setting]').classList.toggle('on');
    if (event.target.closest('[data-open-files]')) launchApp('files');
    if (event.target.closest('[data-settings-power]')) togglePanel('power-menu', true);
  });
  showSection('personal');
}

function renderPaint(win) {
  win.content.innerHTML = `
    <div class="paint-wrap">
      <div class="paint-toolbar">
        <button data-paint-clear>Clear</button><button data-paint-open>Open PNG</button><button data-paint-save>Save PNG</button>
        <label>Color <input type="color" data-paint-color value="#292d45"></label>
        <label>Brush <input type="range" data-paint-size min="1" max="40" value="6"></label>
      </div>
      <div class="paint-canvas-wrap"><canvas class="paint-canvas" width="800" height="500" aria-label="Drawing canvas"></canvas></div>
    </div>`;
  const canvas = $('.paint-canvas', win.content);
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  let drawing = false;
  canvas.addEventListener('pointerdown', (event) => {
    drawing = true;
    canvas.setPointerCapture(event.pointerId);
    const bounds = canvas.getBoundingClientRect();
    context.beginPath();
    context.moveTo((event.clientX - bounds.left) * canvas.width / bounds.width, (event.clientY - bounds.top) * canvas.height / bounds.height);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!drawing) return;
    const bounds = canvas.getBoundingClientRect();
    context.lineTo((event.clientX - bounds.left) * canvas.width / bounds.width, (event.clientY - bounds.top) * canvas.height / bounds.height);
    context.strokeStyle = $('[data-paint-color]', win.content).value;
    context.lineWidth = Number($('[data-paint-size]', win.content).value);
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.stroke();
  });
  canvas.addEventListener('pointerup', () => { drawing = false; });
  $('[data-paint-clear]', win.content).addEventListener('click', () => {
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
  });
  $('[data-paint-save]', win.content).addEventListener('click', async () => {
    const name = prompt('Save drawing as (in Pictures):', 'My drawing.png');
    if (!name) return;
    try {
      await window.aether.files.write(`/Pictures/${name.toLowerCase().endsWith('.png') ? name : `${name}.png`}`, canvas.toDataURL('image/png'));
      showToast('Drawing saved to Pictures.');
    } catch (error) { showToast(error.message, true); }
  });
  $('[data-paint-open]', win.content).addEventListener('click', async () => {
    const path = prompt('Enter the virtual path of a PNG image:', '/Pictures/My drawing.png');
    if (!path) return;
    try {
      const image = new Image();
      image.onload = () => {
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
      };
      image.src = await window.aether.files.read(path);
    } catch (error) { showToast(error.message, true); }
  });
  if (win.options.path) {
    window.aether.files.read(win.options.path).then((url) => {
      const image = new Image();
      image.onload = () => context.drawImage(image, 0, 0, canvas.width, canvas.height);
      image.src = url;
    }).catch((error) => showToast(error.message, true));
  }
}

function renderTaskManager(win) {
  win.content.innerHTML = `<div style="padding:20px;overflow:auto;height:100%"><h2 style="margin:0 0 5px;font:700 20px Manrope,sans-serif">Performance</h2><p style="color:var(--muted);font-size:11px;margin:0 0 18px">Live device metrics · Aether Desktop</p><div data-system-stats></div></div>`;
  const stats = $('[data-system-stats]', win.content);
  let previous = null;
  const refresh = async () => {
    try {
      const info = await window.aether.system.info();
      const times = info.cpuTimes.reduce((result, cpu) => ({
        idle: result.idle + cpu.idle,
        total: result.total + cpu.user + cpu.nice + cpu.sys + cpu.idle + cpu.irq
      }), { idle: 0, total: 0 });
      let cpuPercent = 0;
      if (previous) {
        const idle = times.idle - previous.idle;
        const total = times.total - previous.total;
        cpuPercent = total > 0 ? Math.round(100 * (1 - idle / total)) : 0;
      }
      previous = times;
      const used = info.totalMemory - info.freeMemory;
      const memoryPercent = Math.round(used * 100 / info.totalMemory);
      stats.innerHTML = `
        <div class="stats-card"><h3>CPU</h3><p><span>Utilization</span><strong>${cpuPercent}%</strong></p><div class="stats-meter"><span style="width:${cpuPercent}%"></span></div><p><span>Logical processors</span><strong>${info.cpuCount}</strong></p></div>
        <div class="stats-card"><h3>Memory</h3><p><span>In use</span><strong>${(used / 1024 ** 3).toFixed(1)} / ${(info.totalMemory / 1024 ** 3).toFixed(1)} GB</strong></p><div class="stats-meter"><span style="width:${memoryPercent}%"></span></div><p><span>Available</span><strong>${(info.freeMemory / 1024 ** 3).toFixed(1)} GB</strong></p></div>
        <div class="stats-card"><h3>Device</h3><p><span>Platform</span><strong>${escapeHtml(info.platform)}</strong></p><p><span>System version</span><strong>${escapeHtml(info.release)}</strong></p><p><span>Running apps</span><strong>${windows.size}</strong></p></div>`;
    } catch (error) { showToast(`Could not read system metrics: ${error.message}`, true); }
  };
  refresh();
  win.statsTimer = setInterval(refresh, 1500);
}

function renderStore(win) {
  win.content.innerHTML = `
    <div style="padding:24px;overflow:auto;height:100%">
      <h2 style="margin:0 0 4px;font:700 21px Manrope,sans-serif">Discover your apps</h2>
      <p style="margin:0 0 18px;color:var(--muted);font-size:11px">Everything you need to get started, already included.</p>
      <label class="start-search" style="margin-bottom:17px"><span>⌕</span><input data-store-search placeholder="Search apps"></label>
      <div class="store-grid" data-store-grid></div>
      <p style="color:var(--muted);font-size:10px;margin-top:18px">Aether apps are bundled with your desktop. Website installs and OS-level software packages aren't supported by this simulator.</p>
    </div>`;
  const grid = $('[data-store-grid]', win.content);
  const render = (filter = '') => {
    grid.innerHTML = apps.filter((app) => app.name.toLowerCase().includes(filter.toLowerCase())).map((app) => `
      <div class="store-card">${appIcon(app)}<b>${escapeHtml(app.name)}</b><p>Included with Aether Desktop</p>
        <button data-store-open="${app.id}">Open</button></div>`).join('') || '<div class="empty-folder">No apps match your search.</div>';
  };
  $('[data-store-search]', win.content).addEventListener('input', (event) => render(event.target.value));
  win.content.addEventListener('click', (event) => {
    const button = event.target.closest('[data-store-open]');
    if (button) launchApp(button.dataset.storeOpen);
  });
  render();
}

function showPowerScreen(isRestart) {
  togglePanel('power-menu', false);
  togglePanel('start-menu', false);
  togglePanel('notification-panel', false);
  for (const id of [...windows.keys()]) closeWindow(id);
  $('#desktop').classList.add('hidden');
  const screen = document.createElement('section');
  screen.id = 'power-screen';
  screen.className = 'system-screen power-screen';
  screen.innerHTML = `<div class="boot-mark">✦</div><h1>${isRestart ? 'Restarting Aether…' : 'Aether is shut down.'}</h1>${isRestart ? '<div class="boot-spinner"></div>' : '<button id="restart-after-shutdown" class="primary-button" style="width:190px">Start Aether</button>'}`;
  document.body.append(screen);
  if (isRestart) {
    setTimeout(() => {
      screen.remove();
      $('#desktop').classList.remove('hidden');
      showToast('Welcome back.');
    }, 1400);
  } else {
    $('#restart-after-shutdown').addEventListener('click', () => {
      screen.remove();
      $('#desktop').classList.remove('hidden');
    });
  }
}

function initialize() {
  buildShortcuts();
  $('#profile-label').textContent = currentUser;
  updateClock();
  setInterval(updateClock, 15000);
  document.body.classList.toggle('light-mode', localStorage.getItem('aether-theme') === 'light');

  $('#login-button').addEventListener('click', () => {
    currentUser = $('#login-name').value.trim() || 'Alex Morgan';
    localStorage.setItem('aether-user', currentUser);
    $('#profile-label').textContent = currentUser;
    $('#login-screen').classList.add('hidden');
    $('#desktop').classList.remove('hidden');
  });
  $('#login-name').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') $('#login-button').click();
  });
  $('#start-button').addEventListener('click', () => togglePanel('start-menu'));
  $('#task-search').addEventListener('click', () => togglePanel('start-menu', true));
  $('#app-search').addEventListener('input', (event) => {
    const filter = event.target.value.toLowerCase();
    $$('.start-app', $('#start-apps')).forEach((button) => {
      button.classList.toggle('hidden', !button.textContent.toLowerCase().includes(filter));
    });
  });
  $('#tray-network').addEventListener('click', () => togglePanel('notification-panel'));
  $('#tray-notifications').addEventListener('click', () => togglePanel('notification-panel'));
  $('#tray-clock').addEventListener('click', () => togglePanel('notification-panel'));
  $('#panel-power').addEventListener('click', () => togglePanel('power-menu', true));
  $('#start-power').addEventListener('click', () => togglePanel('power-menu', true));
  $$('[data-close-panel]').forEach((button) => button.addEventListener('click', () => togglePanel('notification-panel', false)));
  $('#power-restart').addEventListener('click', () => showPowerScreen(true));
  $('#power-shutdown').addEventListener('click', () => showPowerScreen(false));
  $$('[data-toggle-wifi], [data-toggle-mode]').forEach((button) => button.addEventListener('click', () => {
    button.classList.toggle('active');
    const description = $('small', button);
    description.textContent = button.classList.contains('active') ? 'On' : 'Off';
  }));
  $$('[data-open-settings]').forEach((button) => button.addEventListener('click', () => {
    togglePanel('notification-panel', false);
    launchApp('settings');
  }));
  $('.brightness-slider').addEventListener('input', (event) => {
    $('#desktop').style.filter = `brightness(${event.target.value / 100})`;
  });
  document.body.addEventListener('click', (event) => {
    const launch = event.target.closest('[data-launch]');
    if (launch) launchApp(launch.dataset.launch);
    if (!event.target.closest('#start-menu, #start-button, #task-search, #start-power, #notification-panel, #power-menu, #panel-power, [data-running-window], #tray-network, #tray-notifications, #tray-clock')) {
      $('#start-menu').classList.add('hidden');
      $('#power-menu').classList.add('hidden');
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      $('#start-menu').classList.add('hidden');
      $('#notification-panel').classList.add('hidden');
      $('#power-menu').classList.add('hidden');
    }
    if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'escape') {
      event.preventDefault();
      launchApp('manager');
    }
    if (event.key === 'F11') {
      event.preventDefault();
      const current = windows.get(activeWindow);
      if (current) maximizeWindow(current.id);
    }
  });

  setTimeout(() => {
    $('#boot-screen').classList.add('hidden');
    $('#login-screen').classList.remove('hidden');
    $('#login-name').value = currentUser;
  }, 1100);
}

initialize();
