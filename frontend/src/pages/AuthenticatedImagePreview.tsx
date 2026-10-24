import { useEffect, useRef, useState } from 'react';
import { Image as ImageIcon } from 'lucide-react';
import './TransferPreviewPage.css';
import { cachedImagePreview, loadImagePreview } from './imagePreviewLoader.ts';

export function AuthenticatedImagePreview({ endpoint, imagePath, token, alt, onSessionExpired, paused = false }: {
  endpoint: string; imagePath?: string; token: string; alt: string; onSessionExpired: () => void; paused?: boolean;
}) {
  const [source, setSource] = useState('');
  const [failed, setFailed] = useState(false);
  const placeholder = useRef<HTMLSpanElement>(null);
  const sessionExpired = useRef(onSessionExpired);
  useEffect(() => { sessionExpired.current = onSessionExpired; }, [onSessionExpired]);
  useEffect(() => {
    if (!imagePath || paused) { setSource(''); setFailed(false); return; }
    const controller = new AbortController();
    let objectUrl = '';
    setSource(''); setFailed(false);
    const load = async () => {
      try {
        const blob = await loadImagePreview(endpoint, imagePath, token, controller.signal);
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob); setSource(objectUrl);
      } catch (error) {
        if (!controller.signal.aborted) {
          if ((error as { status?: number }).status === 401) sessionExpired.current();
          else setFailed(true);
        }
      }
    };
    let observer: IntersectionObserver | undefined;
    if (cachedImagePreview(endpoint, imagePath, token) || typeof IntersectionObserver === 'undefined' || !placeholder.current) void load();
    else {
      observer = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting)) { observer?.disconnect(); void load(); }
      }, { rootMargin: '160px' });
      observer.observe(placeholder.current);
    }
    return () => { observer?.disconnect(); controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [endpoint, imagePath, token, paused]);

  return source && !failed
    ? <img className="transfer-preview-image" src={source} alt={alt} decoding="async" onError={() => setFailed(true)} />
    : <span ref={placeholder} className="transfer-preview-image-placeholder" role="img" aria-label={`${alt}: no image available`}>
        <ImageIcon size={15} aria-hidden="true" />
      </span>;
}
