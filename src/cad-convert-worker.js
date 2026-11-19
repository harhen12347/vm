const { parentPort, workerData } = require('node:worker_threads');
const sldprt = require('sldprt');

try {
  const stl = sldprt.toSTL(Buffer.from(workerData));
  if (stl.length < 84) throw new Error('The SLDPRT file did not produce a valid STL.');
  const triangleCount = stl.readUInt32LE(80);
  if (!triangleCount || stl.length !== 84 + triangleCount * 50) {
    throw new Error('The SLDPRT file did not produce a valid STL mesh.');
  }

  const result = new Uint8Array(stl.length);
  result.set(stl);
  parentPort.postMessage({ stl: result.buffer }, [result.buffer]);
} catch (error) {
  parentPort.postMessage({ error: error.message || 'SLDPRT conversion failed.' });
}
