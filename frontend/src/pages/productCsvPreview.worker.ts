import { fileSelectionError, parseProductCsv } from './productCsvPreview.ts';

// Only local File data enters this worker; there are no network or storage calls.
self.onmessage = async (event: MessageEvent<File>) => {
  try {
    const file = event.data;
    const selectionError = fileSelectionError(file.name, file.size);
    if (selectionError) throw new Error(selectionError);
    const bytes = await file.arrayBuffer();
    const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    self.postMessage({ preview: parseProductCsv(source), source });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Unable to read the selected file.' });
  }
};
