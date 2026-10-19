import { useState } from 'react';
import { downloadProductUploadTemplate } from '../utils/productUploadTemplate.ts';
import type { ProductUploadMode } from './productCsvPreview.ts';

export function DemoExcelTemplates() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const download = async (mode: ProductUploadMode) => {
    if (busy) return;
    setBusy(true); setError('');
    try { await downloadProductUploadTemplate(mode); }
    catch { setError('Unable to download the template. Please try again.'); }
    finally { setBusy(false); }
  };
  return <details className="csv-upload-preview">
    <summary>Demo Excel Sheet</summary>
    <div className="csv-upload-file-controls">
      <button type="button" disabled={busy} onClick={() => void download('standard')}>Download Standard Template</button>
      <button type="button" disabled={busy} onClick={() => void download('premises')}>Download Premises-Wise Template</button>
    </div>
    {error && <p className="csv-upload-error" role="alert">{error}</p>}
  </details>;
}
