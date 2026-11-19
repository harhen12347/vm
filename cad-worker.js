importScripts(
  './vendor/container/modern.js',
  './vendor/container/ole.js',
  './vendor/display.js',
  './vendor/inflate.js',
  './vendor/convert.js'
);

self.addEventListener('message', (event) => {
  try {
    const input = new Uint8Array(event.data);
    const parsed = SLDPRTDisplay.parseSLDPRT(
      input,
      SLDPRTInflate.inflateRaw,
      SLDPRTInflate.inflate
    );
    if (!parsed.faces.length) {
      throw new Error(parsed.errors.join('; ') || 'No mesh found in this SLDPRT file.');
    }

    const triangleCount = parsed.stats?.triangles || 0;
    if (triangleCount > 300_000) {
      throw new Error('Model exceeds the browser limit of 300,000 triangles.');
    }

    const mesh = SLDPRTConvert.toSTLBinary(SLDPRTConvert.loadModel(parsed));
    const stl = mesh.buffer.slice(mesh.byteOffset, mesh.byteOffset + mesh.byteLength);
    self.postMessage({ stl }, [stl]);
  } catch (error) {
    self.postMessage({ error: error.message || 'SLDPRT conversion failed.' });
  }
});
