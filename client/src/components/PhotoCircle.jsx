import { useRef, useState } from 'react';
import { Camera } from 'lucide-react';
import { initials } from '../lib/format.js';
import { photoSrc, preloadPhoto, readPhoto } from '../lib/photos.js';

/**
 * El círculo de la foto de una persona de confianza.
 * - Sin foto invita, sin molestar, a ponerla: anillo punteado que late tres veces y «Sube tu foto».
 * - Al tocarlo, el celular ofrece tomarla con la cámara o elegirla de la galería (sin `capture`: las dos opciones).
 * - Con foto, un ícono de cámara en el borde deja cambiarla.
 * onUpload(dataUrl) sube la foto y devuelve su dirección; sin onUpload sólo muestra la foto o las iniciales.
 * tone: 'sky' o 'gold' sobre el azul de la marca; 'leader' o 'head' sobre fondos claros (coordinación).
 */
export default function PhotoCircle({ photo, name, size = 64, onUpload, onError, label = 'Sube tu foto', self = true, tone = 'sky', className = '' }) {
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);
  const src = preview || photoSrc(photo, size);
  const cls = `photo-circle tone-${tone} ${src ? 'has-photo' : ''} ${className}`;
  const style = { '--s': `${size}px` };

  if (!onUpload) {
    return (
      <span className={cls} style={style} aria-hidden="true">
        {src ? <img src={src} alt="" /> : <span className="photo-circle__initials">{initials(name)}</span>}
      </span>
    );
  }

  const pick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      const data = await readPhoto(file);
      setPreview(data);
      const url = await onUpload(data);
      await preloadPhoto(photoSrc(url, size));
      setPreview(null);
    } catch (err) {
      setPreview(null);
      onError?.(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button type="button" className={`${cls} is-editable ${src ? '' : 'is-empty'}`} style={style} disabled={busy}
        onClick={() => input.current?.click()} aria-label={src ? (self ? 'Cambiar tu foto' : 'Cambiar la foto') : label}>
        {src ? <img src={src} alt="" /> : (
          <span className="photo-circle__ask" aria-hidden="true">
            <Camera />
            {size >= 56 && <span>{label}</span>}
          </span>
        )}
        {src && !busy && <span className="photo-circle__badge" aria-hidden="true"><Camera /></span>}
        {busy && <span className="photo-circle__busy" aria-hidden="true"><span className="spinner" /></span>}
      </button>
      <input ref={input} type="file" accept="image/*" hidden tabIndex={-1} onChange={pick} />
    </>
  );
}
