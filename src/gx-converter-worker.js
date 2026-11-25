import { parseGX, makeBinarySTL } from './gx-converter-core.mjs';
import { unzipSync } from './vendor/three/addons/libs/fflate.module.js';

async function decompressGX(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
	if (!('DecompressionStream' in self)) throw new Error('Gzip-compressed GX files are not supported by this browser.');
	const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
	return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  if (bytes.length >= 2 && bytes[0] === 0x78 && 'DecompressionStream' in self) {
	try {
	  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
	  return new Uint8Array(await new Response(stream).arrayBuffer());
	} catch {
	  // A GX payload may begin with these bytes without being a zlib stream.
	}
  }
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b
	  && (bytes[2] === 3 || bytes[2] === 5 || bytes[2] === 7)) {
	const entries = unzipSync(bytes);
	const candidates = Object.entries(entries).filter(([name]) => /\.(gx|gcode|txt)$/i.test(name));
	const gxEntry = candidates.find(([name]) => /\.gx$/i.test(name)) || candidates[0];
	if (!gxEntry) throw new Error('The ZIP archive does not contain a readable GX or G-code file.');
	return gxEntry[1];
  }
  return bytes;
}

self.addEventListener('message', async event => {
  if (event.data?.type !== 'convert') return;
  try {
	self.postMessage({ type: 'progress', value: 22, title: 'Checking compression in background' });
	const bytes = await decompressGX(event.data.buffer);
	self.postMessage({ type: 'progress', value: 28, title: 'Scanning G-code in background' });
	const parsed = parseGX(bytes);
	self.postMessage({ type: 'progress', value: 55, title: 'Extracting settings' });

	const layerValue = parsed.printer['Layer height'] ?? parsed.model['Layer height'];
	const nozzleValue = parsed.printer['Nozzle size'];
	const stl = makeBinarySTL(parsed.gcode, {
	  width: nozzleValue ? Number(nozzleValue) : 0.42,
	  layerHeight: layerValue ? Number(layerValue) : 0.20
	});
	self.postMessage({ type: 'progress', value: 82, title: 'Building binary STL' });
	self.postMessage({
	  type: 'result',
	  result: {
		printer: parsed.printer,
		model: parsed.model,
		stl: stl.stl,
		segments: stl.segments,
		dimensions: stl.dimensions
	  }
	}, [stl.stl.buffer]);
  } catch (error) {
	self.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'The GX file could not be processed.' });
  }
});
