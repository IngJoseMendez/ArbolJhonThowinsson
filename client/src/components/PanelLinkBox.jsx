import { useState } from 'react';
import { Check, Copy, ExternalLink, KeyRound, ShieldAlert } from 'lucide-react';
import { copyText, useToast } from './ui.jsx';

export const panelUrl = (token) => `${window.location.origin}/panel/${token}`;

/**
 * Enlace privado del panel de gestión del líder. Sólo se muestra al emitirlo:
 * en el servidor se guarda su huella, así que no se puede volver a consultar (sólo regenerar).
 */
export default function PanelLinkBox({ token, firstTime }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const url = panelUrl(token);
  const copy = async () => {
    if (await copyText(url)) { setCopied(true); toast('Enlace del panel copiado'); setTimeout(() => setCopied(false), 1500); }
  };
  const wa = `https://wa.me/?text=${encodeURIComponent(`Mi panel de gestión (privado, no reenviar): ${url}`)}`;
  return (
    <div className="panel-link stack" style={{ gap: 10 }}>
      <h3 className="row" style={{ gap: 8 }}><KeyRound size={18} />{firstTime ? 'Tu panel de gestión' : 'Nuevo enlace del panel'}</h3>
      <p className="small text-2" style={{ margin: 0 }}>
        Desde aquí verás cuántas personas se han unido con tu link, sin usuario ni contraseña. Para abrirlo te pedirá
        los <b>últimos 4 dígitos de la cédula</b>.
      </p>
      <div className="link-box"><code title={url}>{url}</code>
        <button type="button" className="btn btn-sm" onClick={copy} aria-label="Copiar enlace del panel">{copied ? <Check size={14} /> : <Copy size={14} />}Copiar</button>
      </div>
      <div className="row-wrap">
        <a className="btn btn-sm btn-primary" href={`/panel/${token}`} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} />Abrir mi panel</a>
        <a className="btn btn-sm btn-wa" href={wa} target="_blank" rel="noopener noreferrer">Guardarlo en mi WhatsApp</a>
      </div>
      <div className="alert alert-warn small"><ShieldAlert size={16} style={{ flex: 'none' }} />
        <span><b>Es privado: no lo compartas.</b> Guárdalo ahora (por ejemplo, envíatelo a tu propio chat): por seguridad no se vuelve a mostrar.
          Si lo pierdes o crees que alguien más lo tiene, pide uno nuevo a tu coordinador y el anterior dejará de funcionar.</span>
      </div>
    </div>
  );
}
