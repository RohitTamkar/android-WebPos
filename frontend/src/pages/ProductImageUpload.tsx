import { useEffect, useRef, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { AuthenticatedImagePreview } from './AuthenticatedImagePreview.tsx';
import { ProductImageCropper } from './ProductImageCropper.tsx';
import { masterImageUrl, uploadMasterImage } from './imageApi.ts';

export function ProductImageUpload({ outletId, documentId, image, token, name, onSaved, onUploadStart, onSessionExpired, paused = false }: {
  outletId: string; documentId: string; image?: string; token: string; name: string;
  onSaved: (reference: string) => void; onUploadStart: () => void; onSessionExpired: () => void; paused?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const busy = useRef(false);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [pending, setPending] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploaded, setUploaded] = useState(false);
  const [savedReference, setSavedReference] = useState('');
  const [error, setError] = useState('');
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  useEffect(() => {
    if (preview && uploaded && image !== savedReference) URL.revokeObjectURL(preview);
  }, [preview, uploaded, image, savedReference]);
  const upload = async (file: File) => {
    if (busy.current) return;
    busy.current = true; onUploadStart(); setSaving(true); setError(''); setPending(file); setPreview(URL.createObjectURL(file));
    try {
      const reference = await uploadMasterImage(outletId, 'products', documentId, token, file, image ?? null);
      onSaved(reference);
      setSavedReference(reference);
      setUploaded(true);
      // Retain the exact processed preview while the new authenticated thumbnail loads.
    } catch (reason) {
      if ((reason as { status?: number }).status === 401) onSessionExpired();
      setError((reason as Error).message);
    } finally { busy.current = false; setSaving(false); }
  };
  const showPreview = !!preview && (!uploaded || image === savedReference);
  return <div className="product-image-upload">
    <input ref={input} type="file" className="local-image-file-input" accept="image/jpeg,image/png,image/webp" aria-label={`Choose image for ${name}`}
      onChange={event => { const file = event.currentTarget.files?.[0]; if (file) { onUploadStart(); setPending(null); setError(''); setCropFile(file); } event.currentTarget.value = ''; }} />
    <button type="button" className="product-image-upload-button" disabled={saving} aria-label={`Upload image for ${name}`} title="Upload from device" onClick={() => input.current?.click()}>
      {showPreview ? <img className="transfer-preview-image" src={preview} alt={`${name} image`} />
        : <AuthenticatedImagePreview endpoint={masterImageUrl(outletId, 'products', documentId)} imagePath={image} token={token} paused={paused} alt={`${name} image`} onSessionExpired={onSessionExpired} />}
    </button>
    {pending && showPreview && <small>{pending.size.toLocaleString()} bytes · {(pending.size / 1024).toFixed(2)} KB</small>}
    {uploaded && image === savedReference && !saving && <p className="products-notice" role="status">Product image uploaded successfully.</p>}
    {pending && !saving && !uploaded && !error && <div>
      {image && <small>This will replace the saved product image.</small>}
      <button type="button" className="btn-secondary" onClick={() => void upload(pending)}>Upload processed image</button>
      <button type="button" className="btn-secondary" onClick={() => { setPending(null); setPreview(''); }}>Cancel image selection</button>
    </div>}
    {saving && <small className="product-image-upload-status" role="status"><LoaderCircle className="product-image-spinner" size={18} aria-hidden="true" />Uploading image…</small>}
    {error && <div><small className="local-image-error" role="alert">{error}</small>
      {pending && <button type="button" className="btn-secondary" disabled={saving} onClick={() => void upload(pending)}>Retry upload</button>}
</div>}
    {cropFile && <ProductImageCropper file={cropFile} onCancel={() => setCropFile(null)} onApply={file => {
      setCropFile(null); setPending(file); setPreview(URL.createObjectURL(file)); setUploaded(false); setError('');
    }} />}
  </div>;
}
