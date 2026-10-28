import { readProductUploadFile } from './productUploadFile.ts';

// Parsing stays local; named premises can be uploaded only after explicit confirmation.
self.onmessage = async (event: MessageEvent<File>) => {
  try { self.postMessage(await readProductUploadFile(event.data, 'premises')); }
  catch (error) { self.postMessage({ error: error instanceof Error ? error.message : 'Unable to preview the premises file.' }); }
};
