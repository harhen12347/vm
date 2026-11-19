const MAX_FILE_BYTES = 128 * 1024 * 1024;
const MAX_FILES = 50;

const fileInput = document.querySelector('#file-input');
const dropzone = document.querySelector('#dropzone');
const convertButton = document.querySelector('#convert-button');
const progress = document.querySelector('#progress');
const results = document.querySelector('#results');
const converter = new Worker('./cad-worker.js');
let files = [];
let busy = false;
const downloadUrls = new Set();
let pendingConversion = null;

converter.addEventListener('message', (event) => {
  if (!pendingConversion) return;
  const { resolve, reject } = pendingConversion;
  pendingConversion = null;
  if (event.data.error) reject(new Error(event.data.error));
  else resolve(new Blob([event.data.stl], { type: 'model/stl' }));
});

converter.addEventListener('error', (event) => {
  if (!pendingConversion) return;
  pendingConversion.reject(new Error(event.message || 'The CAD converter worker stopped unexpectedly.'));
  pendingConversion = null;
});

function convertInBrowser(input) {
  return new Promise((resolve, reject) => {
    pendingConversion = { resolve, reject };
    try {
      converter.postMessage(input, [input]);
    } catch (error) {
      pendingConversion = null;
      reject(error);
    }
  });
}

function clearDownloads() {
  for (const url of downloadUrls) URL.revokeObjectURL(url);
  downloadUrls.clear();
}

function showEmpty() {
  const message = document.createElement('p');
  message.className = 'empty';
  message.textContent = 'Your selected files and downloads will appear here.';
  results.replaceChildren(message);
}

function addResultRow(file, index, initialStatus = 'Ready to convert', isError = false) {
  const row = document.createElement('div');
  row.className = 'file-row';
  row.dataset.index = String(index);

  const name = document.createElement('span');
  name.className = 'file-name';
  name.title = file.name;
  name.textContent = file.name;

  const status = document.createElement('span');
  status.className = `file-status${isError ? ' error' : ''}`;
  status.dataset.status = '';
  status.textContent = initialStatus;

  const download = document.createElement('a');
  download.className = 'download';
  download.hidden = true;
  download.textContent = 'Download STL';

  row.append(name, status, download);
  results.append(row);
  return row;
}

function setFiles(selection) {
  if (busy) return;
  clearDownloads();
  const selected = Array.from(selection);
  const valid = selected.filter((file) => /\.sldprt$/i.test(file.name));
  const invalidCount = selected.length - valid.length;
  files = valid.slice(0, MAX_FILES);

  results.replaceChildren();
  if (!files.length) showEmpty();

  files.forEach((file, index) => {
    if (file.size > MAX_FILE_BYTES) {
      addResultRow(file, index, 'File exceeds the 128 MB limit.', true);
    } else {
      addResultRow(file, index);
    }
  });

  const oversizedCount = files.filter((file) => file.size > MAX_FILE_BYTES).length;
  const tooManyCount = Math.max(0, valid.length - MAX_FILES);
  const notices = [];
  if (invalidCount) notices.push(`${invalidCount} non-SLDPRT file${invalidCount === 1 ? '' : 's'} skipped`);
  if (tooManyCount) notices.push(`only the first ${MAX_FILES} SLDPRT files selected`);
  if (oversizedCount) notices.push(`${oversizedCount} file${oversizedCount === 1 ? '' : 's'} exceed the size limit`);
  const readyCount = files.length - oversizedCount;
  convertButton.disabled = readyCount === 0;
  progress.textContent = notices.length
    ? `${notices.join('; ')}${readyCount ? `. ${readyCount} ready to convert.` : '.'}`
    : readyCount ? `${readyCount} file${readyCount === 1 ? '' : 's'} ready to convert.` : 'Choose one or more .SLDPRT files.';
  fileInput.value = '';
}

fileInput.addEventListener('change', () => setFiles(fileInput.files));

for (const eventName of ['dragenter', 'dragover']) {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.classList.add('dragging');
  });
}

for (const eventName of ['dragleave', 'drop']) {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    if (eventName === 'drop') setFiles(event.dataTransfer.files);
    dropzone.classList.remove('dragging');
  });
}

convertButton.addEventListener('click', async () => {
  if (busy) return;
  const convertible = files.filter((file) => file.size <= MAX_FILE_BYTES);
  if (!convertible.length) return;
  busy = true;
  fileInput.disabled = true;
  convertButton.disabled = true;
  let convertedCount = 0;
  let processedCount = 0;

  for (const [index, file] of files.entries()) {
    if (file.size > MAX_FILE_BYTES) continue;
    processedCount++;
    const row = results.querySelector(`[data-index="${index}"]`);
    const status = row.querySelector('[data-status]');
    const download = row.querySelector('.download');
    status.classList.remove('error');
    status.textContent = `Converting ${processedCount} of ${convertible.length}…`;
    progress.textContent = `Converting ${file.name}…`;

    try {
      const input = await file.arrayBuffer();
      const blob = await convertInBrowser(input);
      const url = URL.createObjectURL(blob);
      downloadUrls.add(url);
      download.href = url;
      download.download = `${file.name.replace(/\.sldprt$/i, '') || 'model'}.stl`;
      download.hidden = false;
      status.textContent = `Ready · ${blob.size.toLocaleString()} bytes`;
      convertedCount++;
    } catch (error) {
      status.textContent = `Failed: ${error.message}`;
      status.classList.add('error');
    }
  }

  busy = false;
  fileInput.disabled = false;
  convertButton.disabled = !files.some((file) => file.size <= MAX_FILE_BYTES);
  progress.textContent = `Finished: ${convertedCount} of ${convertible.length} converted. Download each STL below.`;
});

window.addEventListener('beforeunload', clearDownloads);
