import { makeModelMetadata, validatePrinterConfiguration, validateBinarySTL } from './gx-converter-core.mjs';
import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';

const fileInput = document.querySelector('#gx-file');
const dropzone = document.querySelector('#dropzone');
const fileMeta = document.querySelector('#file-meta');
const convertButton = document.querySelector('#convert-button');
const resetButton = document.querySelector('#reset-button');
const progressPanel = document.querySelector('#progress-panel');
const progressBar = document.querySelector('#progress-bar');
const progressTitle = document.querySelector('#progress-title');
const progressValue = document.querySelector('#progress-value');
const notice = document.querySelector('#notice');
const results = document.querySelector('#results');
let selectedFile = null;

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function showNotice(message, kind = 'error') {
  notice.textContent = message;
  notice.className = `notice ${kind}`;
  notice.hidden = false;
}

function setProgress(value, title) {
  progressPanel.hidden = false;
  progressBar.style.width = `${value}%`;
  progressValue.textContent = `${value}%`;
  if (title) progressTitle.textContent = title;
}

function selectFile(file) {
  selectedFile = null;
  notice.hidden = true;
  results.hidden = true;
  if (!file) return;
  if (!/\.(gx|zip|gz)$/i.test(file.name)) {
	showNotice('Unsupported file type. Select a .gx file or a gzip/ZIP-wrapped GX container.');
	fileMeta.textContent = '';
	return;
  }
  if (file.size < 64) {
	showNotice('The selected file is damaged or too small to be a valid GX file.');
	fileMeta.textContent = '';
	return;
  }
  if (file.size > 512 * 1024 * 1024) {
	showNotice('The selected file is larger than 512 MB. Choose a smaller GX container.');
	fileMeta.textContent = '';
	return;
  }
  selectedFile = file;
  fileMeta.textContent = `${file.name} • ${formatSize(file.size)}`;
  convertButton.disabled = false;
  resetButton.disabled = false;
}

fileInput.addEventListener('change', () => selectFile(fileInput.files[0]));
for (const eventName of ['dragenter', 'dragover']) dropzone.addEventListener(eventName, event => {
  event.preventDefault(); dropzone.classList.add('dragging');
});
for (const eventName of ['dragleave', 'drop']) dropzone.addEventListener(eventName, event => {
  event.preventDefault(); dropzone.classList.remove('dragging');
});
dropzone.addEventListener('drop', event => selectFile(event.dataTransfer.files[0]));

function blobLink(id, blob, filename) {
  const link = document.querySelector(id);
  link.classList.remove('disabled');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
}

function renderSettings(id, settings) {
  const host = document.querySelector(id);
  host.replaceChildren();
  const entries = Object.entries(settings);
  if (!entries.length) {
	const row = document.createElement('div'); row.className = 'setting-row'; row.innerHTML = '<span>No fields found</span><b>Not present in source</b>'; host.append(row); return;
  }
  for (const [label, value] of entries) {
	const row = document.createElement('div'); row.className = 'setting-row';
	const key = document.createElement('span'); key.textContent = label;
	const data = document.createElement('b'); data.textContent = String(value);
	row.append(key, data); host.append(row);
  }
}

let previewCleanup = null;
function previewSTL(buffer) {
  const host = document.querySelector('#model-preview');
  host.replaceChildren();
  if (buffer.byteLength > 2 * 1024 * 1024) {
	host.textContent = 'The reconstructed model is large, so its preview was skipped to keep this page responsive. The STL download is ready.';
	return;
  }
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x242b34);
  const camera = new THREE.PerspectiveCamera(35, host.clientWidth / host.clientHeight, 0.1, 2000);
  camera.position.set(180, 130, 180);
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true });
  } catch {
    host.textContent = '3D preview is unavailable in this browser. The STL download is still ready.';
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(host.clientWidth, host.clientHeight);
  host.append(renderer.domElement);
  scene.add(new THREE.HemisphereLight(0xeaf1ff, 0x26303a, 2.2));
  const geometry = new STLLoader().parse(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0x86a9ad, roughness: 0.55, metalness: 0.05 }));
  mesh.position.sub(center); scene.add(mesh);
  const maxDimension = Math.max(size.x, size.y, size.z, 1);
  camera.position.set(maxDimension * 1.25, maxDimension * 0.9, maxDimension * 1.25);
  camera.lookAt(0, 0, 0);
  let frame;
  const animate = () => { frame = requestAnimationFrame(animate); mesh.rotation.z += 0.0025; renderer.render(scene, camera); };
  animate();
  previewCleanup = () => { cancelAnimationFrame(frame); renderer.dispose(); renderer.domElement.remove(); };
}

function processInWorker(buffer, onProgress) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./gx-converter-worker.js', import.meta.url), { type: 'module' });
    worker.addEventListener('message', event => {
      const message = event.data;
      if (message.type === 'progress') {
        onProgress(message.value, message.title);
        return;
      }
      worker.terminate();
      if (message.type === 'error') reject(new Error(message.message));
      else resolve(message.result);
    });
    worker.addEventListener('error', event => {
      worker.terminate();
      reject(new Error(event.message || 'GX conversion worker failed.'));
    }, { once: true });
    worker.postMessage({ type: 'convert', buffer }, [buffer]);
  });
}

convertButton.addEventListener('click', async () => {
  if (!selectedFile) return;
  const sourceFile = selectedFile;
  convertButton.disabled = true;
  resetButton.disabled = true;
  notice.hidden = true;
  setProgress(8, 'Reading GX container');
  try {
	await new Promise(resolve => setTimeout(resolve, 20));
	const sourceBuffer = await sourceFile.arrayBuffer();
	setProgress(20, 'Processing GX in background');
	const result = await processInWorker(sourceBuffer, setProgress);
	const parsed = { printer: result.printer, model: result.model };
	const stl = { stl: result.stl, segments: result.segments, dimensions: result.dimensions };

	validatePrinterConfiguration(parsed.printer);
	validateBinarySTL(stl.stl);
	renderSettings('#printer-settings', parsed.printer);
	renderSettings('#model-settings', parsed.model);
	const baseName = sourceFile.name.replace(/\.gx$/i, '').replace(/\.(zip|gz)$/i, '');
	const printerJson = JSON.stringify(parsed.printer, null, 2);
	const metadataJson = makeModelMetadata(sourceFile.name, parsed.printer, parsed.model);
	blobLink('#printer-download', new Blob([printerJson], { type: 'application/json' }), `${baseName}-printer.json`);
	blobLink('#model-download', new Blob([metadataJson], { type: 'application/json' }), `${baseName}-metadata.json`);
	blobLink('#stl-download', new Blob([stl.stl], { type: 'model/stl' }), `${baseName}.stl`);

	document.querySelector('#model-dimensions').innerHTML = `<span>X <b>${stl.dimensions.x.toFixed(1)} mm</b></span><span>Y <b>${stl.dimensions.y.toFixed(1)} mm</b></span><span>Z <b>${stl.dimensions.z.toFixed(1)} mm</b></span><span><b>${stl.segments.toLocaleString()}</b> toolpaths</span>`;
	if (previewCleanup) previewCleanup();
	previewSTL(stl.stl);

	results.hidden = false;
	setProgress(100, 'Conversion complete');
	showNotice(`Conversion complete. STL contains ${stl.segments.toLocaleString()} reconstructed extrusion segments.`, 'success');
  } catch (error) {
	setProgress(100, 'Conversion failed');
	showNotice(error instanceof Error ? error.message : 'The GX file could not be processed.');
  } finally {
	convertButton.disabled = false;
	resetButton.disabled = false;
  }
});

resetButton.addEventListener('click', () => {
  if (previewCleanup) previewCleanup();
  selectedFile = null;
  fileInput.value = '';
  fileMeta.textContent = '';
  convertButton.disabled = true;
  resetButton.disabled = true;
  progressPanel.hidden = true;
  notice.hidden = true;
  results.hidden = true;
});
