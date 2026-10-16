import { useEffect, useRef } from 'react';
import { Trash2, X } from 'lucide-react';
import './CategoryPage.css';
import './DeleteConfirmation.css';

export function DeleteConfirmation({ kind, name, busy, onCancel, onConfirm }: {
  kind: 'product' | 'category'; name: string; busy: boolean; onCancel: () => void; onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    dialogRef.current?.showModal();
    cancelRef.current?.focus();
  }, []);
  return (
    <dialog ref={dialogRef} className="category-modal delete-confirmation" role="alertdialog" aria-modal="true"
      aria-labelledby="delete-confirmation-title" aria-describedby="delete-confirmation-description"
      onCancel={event => { event.preventDefault(); if (!busy) onCancel(); }}>
      <div className="modal-header"><h3 id="delete-confirmation-title">Delete {kind}?</h3>
        <button type="button" className="modal-close-btn" aria-label="Close delete confirmation" disabled={busy} onClick={onCancel}><X size={18} /></button>
      </div>
      <div className="modal-body">
        <Trash2 className="delete-confirmation-icon" size={32} aria-hidden="true" />
        <p id="delete-confirmation-description">Are you sure you want to delete <strong>{name}</strong>? This will permanently remove this {kind} from the database.</p>
      </div>
      <div className="modal-footer">
        <button ref={cancelRef} type="button" className="btn-secondary delete-confirmation-cancel" disabled={busy} onClick={onCancel}>Cancel</button>
        <button type="button" className="btn-primary-add delete-confirmation-confirm" disabled={busy} onClick={onConfirm}>{busy ? 'Deleting…' : 'Delete'}</button>
      </div>
    </dialog>
  );
}
