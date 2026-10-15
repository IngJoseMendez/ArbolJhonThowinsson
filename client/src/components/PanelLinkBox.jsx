import { useState } from 'react';
import { Check, Copy, ExternalLink, KeyRound, ShieldAlert } from 'lucide-react';
import { copyText, useToast, WhatsAppIcon } from './ui.jsx';

export const panelUrl = (token) => `${window.location.origin}/panel/${token}`;

/**
 * Enlace privado del panel de gestión (líder o cabeza). Sólo se muestra al emitirlo:
 * en el servidor se guarda su huella, así que no se puede volver a consultar (sólo regenerar).
 */
export default function PanelLinkBox({ token, firstTime, head }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const url = panelUrl(token);
  const copy = async () => {
    if (await copyText(url)) { setCopied(true); toast('Enlace del panel copiado'); setTimeout(() => setCopied(false), 1500); }
  };
  const wa = `https://wa.me/?text=${encodeURIComponent(`Mi panel del equipo Thowinsson (privado, no reenviar): ${url}`)}`;
  return (
    <div className="panel-link stack" style={{ gap: 12 }}>
      <h3 className="row" style={{ gap: 8, fontFamily: 'var(--font-display)', fontSize: 19 }}><KeyRound size={19} />{firstTime ? (head ? 'Tu panel de cabeza' : 'Tu panel') : 'Nuevo enlace del panel'}</h3>
      <p className="text-2" style={{ margin: 0 }}>
        {head
          ? 'Desde aquí invitas a tus líderes y ves crecer todo tu equipo, sin usuario ni contraseña.'
          : 'Desde aquí ves cuántas personas se han unido con tu link, sin usuario ni contraseña.'}
        {' '}Para abrirlo te pedirá los <b>últimos 4 dígitos de tu cédula</b>.
      </p>
      <div className="share-actions">
        <a className="btn btn-lg btn-primary" style={{ gridColumn: '1 / -1' }} href={`/panel/${token}`} target="_blank" rel="noopener noreferrer"><ExternalLink size={18} />Abrir mi panel</a>
        <a className="btn btn-wa" style={{ gridColumn: 'auto' }} href={wa} target="_blank" rel="noopener noreferrer"><WhatsAppIcon size={16} />Guardar en mi chat</a>
        <button type="button" className="btn" onClick={copy} aria-label="Copiar enlace del panel">{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? 'Copiado' : 'Copiar'}</button>
      </div>
      <div className="alert alert-warn"><ShieldAlert size={16} />
        <span><b>Es privado: no lo compartas.</b> Guárdalo ahora (por ejemplo, envíalo a tu propio chat de WhatsApp): por seguridad no se vuelve a mostrar.
          Si lo pierdes, pide uno nuevo a tu coordinador y el anterior dejará de funcionar.</span>
      </div>
    </div>
  );
}
