import { useEffect, useRef, useState } from 'react';
import { Image as ImageIcon, Upload, X } from 'lucide-react';
import './LocalImagePicker.css';
import { ProductImageCropper } from './ProductImageCropper.tsx';

interface Props {
  id: string;
  label: string;
  existingImagePath?: string;
  imageEndpoint?: string;
  token?: string;
  onSelectedFile?: (file: File | null) => void;
  onRemoveExisting?: (remove: boolean) => void;
  onSessionExpired?: () => void;
  disabled?: boolean;
  cropProductImage?: boolean;
}

const supportedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const maxImageBytes = 5 * 1024 * 1024;

export function LocalImagePicker({ id, label, existingImagePath, imageEndpoint, token,
  onSelectedFile, onRemoveExisting, onSessionExpired, disabled = false, cropProductImage = false }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [selected, setSelected] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [storedPreviewUrl, setStoredPreviewUrl] = useState('');
  const [error, setError] = useState('');
  const [imageFailed, setImageFailed] = useState(false);
  const [removeExisting, setRemoveExisting] = useState(false);
  const [loadingExisting, setLoadingExisting] = useState(false);

  useEffect(() => {
    if (!selected) {
      setPreviewUrl('');
      return;
    }
    const url = URL.createObjectURL(selected);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [selected]);

  useEffect(() => {
    if (!existingImagePath || !imageEndpoint || !token) {
      setStoredPreviewUrl('');
      setLoadingExisting(false);
      return;
    }
    const controller = new AbortController();
    let objectUrl = '';
    setLoadingExisting(true);
    void (async () => {
      try {
        const response = await fetch(imageEndpoint, { headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store', signal: controller.signal });
        if (response.status === 401) { onSessionExpired?.(); throw new Error('Your session has expired.'); }
        if (!response.ok) throw new Error('Unable to load the saved image.');
        const blob = await response.blob();
        if (!blob.type.startsWith('image/')) throw new Error('The saved file is not a supported image.');
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setStoredPreviewUrl(objectUrl);
      } catch {
        if (!controller.signal.aborted) { setStoredPreviewUrl(''); setError('The saved image is unavailable.'); }
      } finally {
        if (!controller.signal.aborted) setLoadingExisting(false);
      }
    })();
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [existingImagePath, imageEndpoint, token, onSessionExpired]);

  const chooseFile = (file?: File, processed = false) => {
    if (!file) return;
    if (cropProductImage && !processed) { setCropFile(file); return; }
    if (!supportedTypes.has(file.type.toLowerCase()) || file.size > maxImageBytes) {
      setSelected(null);
      setImageFailed(false);
      setError(file.size > maxImageBytes ? 'Images must be 5 MB or smaller.' : 'Choose a JPEG, PNG, or WebP image.');
      setRemoveExisting(false);
      onSelectedFile?.(null);
      onRemoveExisting?.(false);
      if (input.current) input.current.value = '';
      return;
    }
    setError('');
    setImageFailed(false);
    setRemoveExisting(false);
    onRemoveExisting?.(false);
    onSelectedFile?.(file);
    setSelected(file);
  };

  const clearSelection = () => {
    setSelected(null);
    setError('');
    setImageFailed(false);
    onSelectedFile?.(null);
    if (input.current) input.current.value = '';
  };

  const requestRemoval = () => {
    setRemoveExisting(true);
    setImageFailed(false);
    setError('');
    onRemoveExisting?.(true);
  };

  const currentUrl = selected ? previewUrl : removeExisting ? '' : storedPreviewUrl;
  const hasImage = !!currentUrl && !imageFailed;
  const hasSavedImage = !!existingImagePath;

  return <div className="local-image-picker" aria-labelledby={`${id}-label`}>
    {cropFile && <ProductImageCropper file={cropFile} onCancel={() => setCropFile(null)} onApply={file => { setCropFile(null); chooseFile(file, true); }} />}
    <span className="local-image-picker-label" id={`${id}-label`}>{label}</span>
    <div className="local-image-picker-content">
      <button type="button" disabled={disabled} onClick={() => input.current?.click()} className="local-image-preview" aria-label={hasImage ? 'Image preview' : 'No image selected'}>
        {hasImage ? <img src={currentUrl} alt={selected ? 'Selected image preview' : 'Existing image preview'} onError={() => setImageFailed(true)} />
          : <span className="local-image-placeholder"><ImageIcon size={24} aria-hidden="true" /><span>{loadingExisting ? 'Loading image…' : 'No image'}</span></span>}
      </button>
      <div className="local-image-picker-actions">
        <input ref={input} id={`${id}-file`} type="file" accept="image/jpeg,image/png,image/webp" disabled={disabled} className="local-image-file-input"
          aria-label="Choose an image file" onChange={event => { chooseFile(event.currentTarget.files?.[0]); event.currentTarget.value = ''; }} />
        <button type="button" className="btn-secondary local-image-button" disabled={disabled}
          onClick={() => input.current?.click()}><Upload size={15} />{selected || hasImage || hasSavedImage ? 'Replace Image' : 'Add Image'}</button>
        {selected && <button type="button" className="btn-secondary local-image-button" disabled={disabled}
          onClick={clearSelection}><X size={15} />Clear Selection</button>}
        {!selected && hasSavedImage && !removeExisting && <button type="button" className="btn-secondary local-image-button" disabled={disabled}
          onClick={requestRemoval}><X size={15} />Remove Image</button>}
        {!selected && removeExisting && <button type="button" className="btn-secondary local-image-button" disabled={disabled}
          onClick={() => { setRemoveExisting(false); onRemoveExisting?.(false); }}><X size={15} />Undo Remove</button>}
        <span className="local-image-help">{selected && cropProductImage && `${selected.size.toLocaleString()} bytes · `}{selected && `${(selected.size / 1024).toFixed(2)} KB · `}The image is uploaded when you save the form.</span>
      </div>
    </div>
    {error && <p className="local-image-error" role="alert">{error}</p>}
  </div>;
}
