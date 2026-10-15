import { useState } from 'react';
import { Download, Share, SquarePlus, X } from 'lucide-react';
import { Monogram } from '../brand/Brand.jsx';
import { useInstall } from '../lib/pwa.js';

const dismissedKey = (k) => `install-hint:${k}`;
const wasDismissed = (k) => { try { return localStorage.getItem(dismissedKey(k)) === '1'; } catch { return false; } };

/**
 * Invita a guardar la app en la pantalla de inicio del celular: en Android con el aviso de instalación
 * y en iPhone con las instrucciones (Compartir → Agregar a inicio). No aparece si ya está instalada.
 */
export default function InstallHint({ what = 'tu panel', storageKey = 'panel' }) {
  const inst = useInstall();
  const [hidden, setHidden] = useState(() => wasDismissed(storageKey));
  const [steps, setSteps] = useState(false);
  if (hidden || inst.standalone || (!inst.canPrompt && !inst.ios)) return null;
  const close = () => { try { localStorage.setItem(dismissedKey(storageKey), '1'); } catch { /* sin almacenamiento */ } setHidden(true); };
  return (
    <div className="install-hint" role="note">
      <span className="install-icon"><Monogram /></span>
      <div className="install-text">
        <b>Lleva {what} en tu celular</b>
        {inst.ios ? (
          steps ? (
            <ol className="install-steps">
              <li>Toca <Share size={15} aria-label="Compartir" /> <b>Compartir</b> en la barra de Safari.</li>
              <li>Elige <SquarePlus size={15} aria-hidden="true" /> <b>Agregar a inicio</b> y confirma.</li>
            </ol>
          ) : <span className="small text-2">Ábrelo como una app, con un toque desde tu pantalla de inicio.</span>
        ) : <span className="small text-2">Instálalo como una app y ábrelo con un toque.</span>}
        {inst.ios
          ? !steps && <button type="button" className="btn btn-sm btn-primary" onClick={() => setSteps(true)}><SquarePlus size={15} />Ver cómo</button>
          : <button type="button" className="btn btn-sm btn-primary" onClick={async () => { if (await inst.prompt()) close(); }}><Download size={15} />Instalar</button>}
      </div>
      <button type="button" className="btn btn-ghost btn-sm btn-icon install-close" onClick={close} aria-label="No mostrar más"><X size={16} /></button>
    </div>
  );
}
