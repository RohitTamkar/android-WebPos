import { useEffect, useRef } from 'react';
import { CheckCircle2 } from 'lucide-react';
import './CategoryPage.css';

export function SuccessPopup({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className="category-modal category-updated-popup" role="alertdialog" aria-labelledby="success-popup-title"
    onCancel={event => { event.preventDefault(); onDismiss(); }}>
    <div className="modal-body"><CheckCircle2 size={36} color="#16a34a" aria-hidden="true" /><h3 id="success-popup-title">{message}</h3></div>
    <div className="modal-footer"><button type="button" autoFocus className="btn-primary-add" onClick={onDismiss}>OK</button></div>
  </dialog>;
}
