const path = require('node:path');
const { Worker } = require('node:worker_threads');

const MAX_CAD_FILE_BYTES = 128 * 1024 * 1024;

function convertSldprtToStl(input) {
  let source;
  if (Buffer.isBuffer(input)) source = input;
  else if (input instanceof ArrayBuffer) source = Buffer.from(input);
  else if (ArrayBuffer.isView(input)) source = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  else throw new TypeError('Expected an SLDPRT file buffer.');

  if (!source.length) throw new Error('The selected SLDPRT file is empty.');
  if (source.length > MAX_CAD_FILE_BYTES) {
    throw Object.assign(new Error(`SLDPRT files must be ${MAX_CAD_FILE_BYTES / 1024 / 1024} MB or smaller.`), {
      statusCode: 413
    });
  }

  const transferable = new Uint8Array(source.length);
  transferable.set(source);

  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'cad-convert-worker.js'), {
      workerData: transferable.buffer,
      transferList: [transferable.buffer]
    });
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    worker.once('message', (result) => {
      if (result.error) {
        fail(new Error(result.error));
        return;
      }
      if (!(result.stl instanceof ArrayBuffer)) {
        fail(new Error('The SLDPRT converter returned an invalid STL result.'));
        return;
      }
      settled = true;
      resolve(Buffer.from(result.stl));
    });
    worker.once('error', fail);
    worker.once('exit', (code) => {
      if (code !== 0) fail(new Error(`The SLDPRT converter stopped unexpectedly (${code}).`));
    });
  });
}

module.exports = { convertSldprtToStl, MAX_CAD_FILE_BYTES };
