import { readProductUploadFile } from './productUploadFile.ts';

// Premises files are previewed locally and never sent to an import endpoint.
self.onmessage = async (event: MessageEvent<File>) => {
  try { self.postMessage(await readProductUploadFile(event.data, 'premises')); }
  catch (error) { self.postMessage({ error: error instanceof Error ? error.message : 'Unable to preview the premises file.' }); }
};
