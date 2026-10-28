import { useEffect, useRef } from 'react';
import { ArrowRight, BookOpen, Building2, FileSpreadsheet, Upload, X } from 'lucide-react';
import './UploadExcelPage.css';
import { CsvUploadPreview } from './CsvUploadPreview.tsx';
import { useBrowserHistoryState } from '../utils/useBrowserHistoryState.ts';
import { ExcelSheetInstructions } from './ExcelSheetInstructions.tsx';

const options = [
  {
    title: 'Upload Excel',
    description: 'Upload your product spreadsheet.',
    message: 'Excel upload functionality will be available in a later phase.',
    icon: FileSpreadsheet,
  },
  {
    title: 'Upload Recipes',
    description: 'Upload recipe information.',
    message: 'Recipe upload functionality will be available in a later phase.',
    icon: BookOpen,
  },
  {
    title: 'Upload with Premises',
    description: 'Upload inventory with premises information.',
    message: 'Preview the standard 14 product fields followed by Premises 1, Premises 2, Premises 3, or more selling-price columns.',
    icon: Building2,
  },
  {
    title: 'Excel Sheet Instructions',
    description: 'View spreadsheet format and guidance.',
    message: 'Explore an illustrative product spreadsheet and check the current upload rules before preparing your CSV file.',
    icon: BookOpen,
  },
];

const validOption = (value: unknown): value is string => value === '' || options.some(option => option.title === value);

export function UploadExcelPage({ outletId, token, onSessionExpired }: { outletId: string; token: string; onSessionExpired: () => void }) {
  const [optionTitle, selectOption, closePreview] = useBrowserHistoryState('pos-upload-option', '', validOption);
  const selectedOption = options.find(option => option.title === optionTitle) ?? null;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const historyCloses = useRef(0);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (selectedOption && !dialog.open) dialog.showModal();
    if (!selectedOption && dialog.open) {
      // A close event may arrive after another dialog has already opened. It
      // must not navigate Back again or close the newly selected upload form.
      historyCloses.current++;
      dialog.close();
    }
  }, [selectedOption]);

  return (
    <section className="upload-excel-page" aria-labelledby="upload-excel-title">
      <header className="upload-excel-heading">
        <h1 id="upload-excel-title"><Upload size={22} aria-hidden="true" />Upload Excel</h1>
        <p>Choose an inventory upload option or view Excel sheet instructions.</p>
      </header>

      <div className="upload-excel-options">
        {options.map(option => {
          const Icon = option.icon;
          return (
            <button key={option.title} type="button" className="upload-excel-option" onClick={() => selectOption(option.title)} aria-haspopup="dialog">
              <span className="upload-excel-icon"><Icon size={22} aria-hidden="true" /></span>
              <span className="upload-excel-copy"><strong>{option.title}</strong><span>{option.description}</span></span>
              <ArrowRight size={18} className="upload-excel-arrow" aria-hidden="true" />
            </button>
          );
        })}
      </div>

      <dialog ref={dialogRef} className={`upload-excel-dialog${selectedOption?.title === 'Excel Sheet Instructions' ? ' upload-excel-instruction-dialog' : selectedOption?.title === 'Upload Excel' || selectedOption?.title === 'Upload with Premises' ? ' upload-excel-preview-dialog' : ''}`} aria-labelledby="upload-excel-dialog-title" aria-describedby="upload-excel-dialog-description"
        onClose={() => {
          if (historyCloses.current) { historyCloses.current--; return; }
          closePreview();
        }} onClick={event => {
          if (event.target !== event.currentTarget) return;
          const bounds = event.currentTarget.getBoundingClientRect();
          if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) {
            closePreview();
          }
        }}>
        <div className="upload-excel-dialog-heading">
          <h2 id="upload-excel-dialog-title">{selectedOption?.title}</h2>
          <button type="button" className="upload-excel-close-icon" aria-label="Close information" onClick={() => closePreview()}><X size={18} /></button>
        </div>
        <p id="upload-excel-dialog-description">{selectedOption?.title === 'Upload Excel' ? 'Select a spreadsheet to validate and preview. Upload adds new products to the selected outlet.' : selectedOption?.message}</p>
        {selectedOption?.title === 'Upload Excel' && <CsvUploadPreview key="standard" outletId={outletId} token={token} onSessionExpired={onSessionExpired} onSuccessAcknowledged={closePreview} />}
        {selectedOption?.title === 'Upload with Premises' && <CsvUploadPreview key="premises" mode="premises" outletId={outletId} token={token} onSessionExpired={onSessionExpired} onSuccessAcknowledged={closePreview} />}
        {selectedOption?.title === 'Excel Sheet Instructions' && <ExcelSheetInstructions />}
        <div className="upload-excel-dialog-actions">
          <button type="button" onClick={() => closePreview()}>Close</button>
        </div>
      </dialog>
    </section>
  );
}
