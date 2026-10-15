import { useEffect } from 'react';
import { WifiOff } from 'lucide-react';
import { api } from '../../api.js';
import { invalidate } from '../../lib/cache.js';
import { useOnline } from '../../lib/device.js';
import { copyNow, getLastSent, subscribeSent } from '../../lib/invites.js';
import { useToast } from '../ui.jsx';

const day = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' });
const sentMessage = (s) => `Invitación de ${s.role === 'head' ? 'cabeza' : 'líder'} enviada. Vence el ${day.format(new Date(s.expires_at))}.`;
// La entregada ya no servía (se anuló mientras estaba preparada) o ya se había enviado desde otra pestaña.
const problemMessage = (s) => (s.closed
  ? `Esa invitación ya no servía: se anularon las sin usar. A quien la reciba no le funcionará; ${s.via === 'copy' ? 'no la pegue y copie' : 'envíele'} la nueva.`
  : 'Esa invitación ya se había enviado desde otra pestaña: sólo una persona podrá usarla. Si fue a dos personas, anúlela y envíe otras.');

/**
 * Confirmación de cada invitación entregada: al volver de WhatsApp aparece «Invitación enviada… [Anular]».
 * Si WhatsApp no se abrió, ofrece copiar el mensaje.
 */
export function SentFeedback() {
  const toast = useToast();
  useEffect(() => {
    let fallback = 0;
    const anular = (s) => ({
      label: 'Anular',
      onClick: async () => {
        try {
          await api.post(`/links/${s.id}/disable`, { reason: 'Enviada por error' });
          invalidate('links:');
          toast('Invitación anulada.');
        } catch (e) { toast(e.message, 'error'); }
      },
    });
    const problem = (s) => {
      s.problemShown = true; s.announced = true;
      toast(problemMessage(s), 'error', s.duplicate ? { action: anular(s) } : undefined);
    };
    const onSent = () => {
      const s = getLastSent();
      if (!s) return;
      if (s.closed || s.duplicate) {
        // Desde WhatsApp se avisa al volver; al copiar o compartir, enseguida.
        if (!s.problemShown && (s.via !== 'whatsapp' || s.at < Date.now() - 1500 && document.visibilityState === 'visible')) problem(s);
        return;
      }
      if (s.announced) return;
      if (s.via === 'copy') { s.announced = true; toast('Invitación copiada: péguela en el chat.', 'ok', { action: anular(s) }); return; }
      if (s.via === 'share') { s.announced = true; toast(sentMessage(s), 'ok', { action: anular(s) }); return; }
      clearTimeout(fallback);
      fallback = setTimeout(() => {
        const cur = getLastSent();
        if (cur?.id !== s.id || document.visibilityState !== 'visible') return;
        if ((cur.closed || cur.duplicate) && !cur.problemShown) { problem(cur); return; }
        if (cur.announced) return;
        cur.announced = true;
        toast('¿No se abrió WhatsApp? Copie el mensaje y péguelo en el chat.', 'error', {
          action: { label: 'Copiar', onClick: () => copyNow(cur.text).then((ok) => ok && toast('Mensaje copiado.')) },
        });
      }, 2500);
    };
    const onVisible = () => {
      if (document.visibilityState === 'hidden') { clearTimeout(fallback); return; }
      const s = getLastSent();
      if (s && s.via === 'whatsapp' && (s.closed || s.duplicate) && !s.problemShown && Date.now() - s.at < 10 * 60e3) { problem(s); return; }
      if (s && s.via === 'whatsapp' && !s.announced && Date.now() - s.at < 10 * 60e3) {
        s.announced = true;
        toast(sentMessage(s), 'ok', { action: anular(s) });
      }
    };
    const unsub = subscribeSent(onSent);
    document.addEventListener('visibilitychange', onVisible);
    return () => { unsub(); clearTimeout(fallback); document.removeEventListener('visibilitychange', onVisible); };
  }, [toast]);
  return null;
}

/** Aviso sin conexión: lo que se ve puede no estar al día (nada se guarda en el dispositivo). */
export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return <div className="m-offline" role="status"><WifiOff size={16} aria-hidden="true" />Sin conexión. Lo que ve puede no estar al día.</div>;
}
