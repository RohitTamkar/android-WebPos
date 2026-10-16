import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, FileSpreadsheet, X } from 'lucide-react';
import { fileSelectionError, PRODUCT_COLUMNS, type CsvPreview } from './productCsvPreview.ts';

const PAGE_SIZE = 50;

export function CsvUploadPreview({ outletId, token, onSessionExpired, onSuccessAcknowledged }: { outletId: string; token: string; onSessionExpired: () => void; onSuccessAcknowledged: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const [filename, setFilename] = useState('');
  const [preview, setPreview] = useState<CsvPreview | null>(null);
  const [error, setError] = useState('');
  const [parsing, setParsing] = useState(false);
  const [page, setPage] = useState(1);
  const [source, setSource] = useState('');
  const [assignedCodes, setAssignedCodes] = useState<(string | number)[] | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');
  const busyRef = useRef(false);
  const requestRef = useRef<AbortController | null>(null);
  const successDialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => () => { workerRef.current?.terminate(); requestRef.current?.abort(); }, []);

  const removeFile = () => {
    if (busyRef.current) return;
    setSource(''); setAssignedCodes(null); setUploaded(false); setUploadStatus('');
    workerRef.current?.terminate();
    workerRef.current = null;
    setFilename('');
    setPreview(null);
    setError('');
    setParsing(false);
    setPage(1);
    if (inputRef.current) inputRef.current.value = '';
  };

  const selectFile = (file: File) => {
    removeFile();
    setFilename(file.name);
    const selectionError = fileSelectionError(file.name, file.size);
    if (selectionError) { setError(selectionError); return; }
    setParsing(true);
    try {
      const worker = new Worker(new URL('./productCsvPreview.worker.ts', import.meta.url), { type: 'module' });
      workerRef.current = worker;
      worker.onmessage = (event: MessageEvent<{ preview?: CsvPreview; error?: string; source?: string }>) => {
        if (workerRef.current !== worker) return;
        setPreview(event.data.preview ?? null);
        setSource(event.data.source ?? '');
        setError(event.data.error ?? '');
        setParsing(false);
        worker.terminate();
        workerRef.current = null;

      };
      worker.onerror = () => {
        if (workerRef.current !== worker) return;
        setError('Unable to read or parse this file. Choose a UTF-8 CSV or TSV file.');
        setParsing(false);
        worker.terminate();
        workerRef.current = null;
      };
      worker.postMessage(file);
    } catch {
      workerRef.current?.terminate();
      workerRef.current = null;
      setParsing(false);
      setError('Local file parsing is unavailable in this browser. No data has been uploaded.');
    }
  };

  const upload = async () => {
    if (busyRef.current || uploaded || !source || !preview || preview.headerErrors.length || !preview.rows.length || preview.rows.some(row => row.errors.length)) return;
    busyRef.current = true; setUploading(true); setError(''); setUploadStatus('Checking categories, tax and product mappings…');
    const controller = new AbortController(); requestRef.current = controller;
    let writeAttempted = false;
    try {
      const options = { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ source }), signal: controller.signal };
      const validation = await fetch(`/api/outlets/${encodeURIComponent(outletId)}/products/import/validate`, options);
      if (controller.signal.aborted) return;
      if (validation.status === 401) { onSessionExpired(); return; }
      const checked = await validation.json() as { writesEnabled?: boolean; message?: string; data?: { canUpload: boolean; headerErrors: string[]; documents: { rowNumber: number; fields: { code: string | number } }[]; rows: { rowNumber: number; errors: { column: string; message: string }[] }[] } };
      if (controller.signal.aborted) return;
      if (!validation.ok || !checked.data?.canUpload) {
        if (checked.data) {
          const issuesByRow = new Map(checked.data.rows.map(row => [row.rowNumber, row.errors]));
          setPreview({ ...preview, headerErrors: checked.data.headerErrors,
            rows: preview.rows.map(row => ({ ...row, errors: issuesByRow.get(row.rowNumber) ?? row.errors })) });
        }
        const issues = checked.data?.rows.flatMap(row => row.errors.map(issue => `Row ${row.rowNumber} · ${issue.column}: ${issue.message}`)) ?? [];
        throw new Error(checked.message || [...(checked.data?.headerErrors ?? []), ...issues.slice(0, 8)].join(' ') || 'The file cannot be imported.');
      }
      const codes = checked.data.documents.map(document => document.fields.code);
      if (!assignedCodes || JSON.stringify(assignedCodes) !== JSON.stringify(codes)) {
        setAssignedCodes(codes);
        setUploadStatus('Review the assigned Search Codes below, then click Upload to confirm. Excel Search Codes are ignored.');
        return;
      }
      if (!checked.writesEnabled) {
        setError('Upload is disabled pending your approval to enable database writes. The file passed validation, but no products were saved.');
        setUploadStatus('Nothing was uploaded. Database writes remain disabled pending approval.');
        return;
      }
      setUploadStatus('Uploading products…');
      writeAttempted = true;
      const response = await fetch(`/api/outlets/${encodeURIComponent(outletId)}/products/import`, { ...options, body: JSON.stringify({ source, codes }) });
      if (controller.signal.aborted) return;
      if (response.status === 401) { onSessionExpired(); return; }
      const result = await response.json() as { success: boolean; message?: string; data?: { success: boolean; created: number; existing: number; confirmedRows: number[]; unconfirmedRows: number[]; message: string } };
      if (controller.signal.aborted) return;
      if (!response.ok || !result.success || !result.data?.success) {
        throw new Error(result.data ? `${result.data.message} Confirmed rows: ${result.data.confirmedRows.join(', ') || 'none'}. Unconfirmed rows: ${result.data.unconfirmedRows.join(', ') || 'none'}.` : result.message || 'Upload outcome is unknown. Retry the same file to reconcile its document IDs.');
      }
      setUploaded(true); setUploadStatus(`${result.data.message} Open Products to view the confirmed records.`);
      successDialogRef.current?.showModal();
    } catch (requestError) {
      if (!controller.signal.aborted) {
        setAssignedCodes(null);
        setError((requestError as Error).message);
        setUploadStatus(writeAttempted
          ? 'No automatic retry was made. Keep this file to reconcile the outcome safely.'
          : 'Nothing was uploaded. Correct the reported file values and select the file again.');
      }
    } finally {
      busyRef.current = false;
      if (!controller.signal.aborted) setUploading(false);
      requestRef.current = null;
    }
  };

  const rows = preview?.rows ?? [];
  const validRows = rows.filter(row => !row.errors.length).length;
  const warningRows = rows.filter(row => row.warnings.length).length;
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const visibleRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const headers = preview?.headerErrors.length ? preview.headers : [...PRODUCT_COLUMNS];
  const columns = Math.max(headers.length, ...visibleRows.map(row => row.cells.length));

  return (
    <div className="csv-upload-preview">
      <dialog ref={successDialogRef} className="upload-excel-dialog csv-upload-success-dialog" aria-labelledby="csv-upload-success-title" aria-describedby="csv-upload-success-description"
        onClose={event => event.stopPropagation()} onCancel={event => event.stopPropagation()}>
        <span className="csv-upload-success-icon"><CheckCircle2 size={32} aria-hidden="true" /></span>
        <h2 id="csv-upload-success-title">Products uploaded successfully</h2>
        <p id="csv-upload-success-description">You can view the uploaded products on the Products page.</p>
        <div className="upload-excel-dialog-actions">
          <button type="button" autoFocus onClick={() => {
            successDialogRef.current?.close();
            onSuccessAcknowledged();
          }}>OK</button>
        </div>
      </dialog>
      <div className="csv-upload-file-controls">
        <input ref={inputRef} type="file" accept=".csv,.tsv" aria-label="Select product CSV or TSV file" hidden
          onChange={event => { const file = event.target.files?.[0]; if (file) selectFile(file); }} />
        <button type="button" disabled={uploading} onClick={() => inputRef.current?.click()}><FileSpreadsheet size={16} />Select File</button>
        {filename && <button type="button" className="csv-upload-secondary" disabled={uploading} onClick={removeFile}><X size={16} />Remove File</button>}
      </div>
      <p className="csv-upload-help">CSV / TSV · UTF-8 · Maximum 5 MB and 10,000 product rows. Comma, tab and semicolon delimiters are detected. XLS/XLSX are not supported.</p>
      {filename && <div className="csv-upload-filename">Selected file: <strong>{filename}</strong></div>}
      {parsing && <p role="status">Reading and validating locally…</p>}
      {error && <p className="csv-upload-error" role="alert">{error}</p>}
      {preview && <>
        <dl className="csv-upload-summary">
          <div><dt>Parsed rows</dt><dd>{rows.length}</dd></div>
          <div><dt>Valid rows</dt><dd>{validRows}</dd></div>
          <div><dt>Rows with errors</dt><dd>{rows.length - validRows}</dd></div>
          <div><dt>Rows with warnings</dt><dd>{warningRows}</dd></div>
        </dl>
        <p className="csv-upload-help">{preview.blankRows} blank rows skipped. Delimiter: {preview.delimiter === '\t' ? 'tab' : preview.delimiter === ',' ? 'comma' : 'semicolon'}. Search Codes are assigned by the server; Excel codes are ignored. {uploaded ? 'Upload confirmed.' : 'No products have been saved by this preview.'}</p>
        {!!preview.headerErrors.length && <div className="csv-upload-error" role="alert">
          <strong>Header errors — spreadsheet row {preview.headerRow}</strong>
          <ul>{preview.headerErrors.map(message => <li key={message}>{message}</li>)}</ul>
        </div>}
        {!rows.length && <p role="status">No product rows found below the header.</p>}
        <div className="csv-upload-table-scroll" role="region" aria-label="Original spreadsheet cells" tabIndex={0}>
          <table>
            <thead><tr><th>Row</th><th>Validation</th>{Array.from({ length: columns }, (_, index) => <th key={index}>{headers[index] || `Unexpected column ${index + 1}`}</th>)}</tr></thead>
            <tbody>{visibleRows.map(row => <tr key={row.rowNumber}>
              <td>{row.rowNumber}</td>
              <td className="csv-upload-row-status">
                <strong>{row.errors.length ? 'Errors' : row.warnings.length ? 'Valid with warnings' : 'Valid'}</strong>
                {[...row.errors.map(issue => ({ ...issue, level: 'Error' })), ...row.warnings.map(issue => ({ ...issue, level: 'Warning' }))].map((issue, index) => (
                  <div key={index} className={issue.level === 'Error' ? 'csv-upload-error' : 'csv-upload-warning'}>{issue.level} · Row {row.rowNumber} · {issue.column}: {issue.message}</div>
                ))}
              </td>
              {Array.from({ length: columns }, (_, index) => <td key={index}><span className="csv-upload-original-cell">{index === 13 ? (assignedCodes?.[rows.indexOf(row)] ?? 'Assigned after validation') : row.cells[index] ?? ''}</span></td>)}
            </tr>)}</tbody>
          </table>
        </div>
        {rows.length > PAGE_SIZE && <div className="csv-upload-pagination">
          <button type="button" disabled={page === 1} onClick={() => setPage(value => value - 1)}>Previous</button>
          <span>Page {page} of {totalPages} · {rows.length} rows</span>
          <button type="button" disabled={page === totalPages} onClick={() => setPage(value => value + 1)}>Next</button>
        </div>}
      </>}
      <div className="csv-upload-import-note"><button type="button" disabled={uploading || uploaded || parsing || !source || !rows.length || validRows !== rows.length || !!preview?.headerErrors.length} onClick={() => void upload()}>{uploading ? 'Checking…' : assignedCodes ? 'Upload' : 'Preview Search Codes'}</button><span role="status">{uploadStatus || 'Upload checks the existing category and product mappings before adding new products. Existing products and categories remain unchanged.'}</span></div>
    </div>
  );
}
