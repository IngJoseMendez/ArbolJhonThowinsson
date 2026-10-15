import { useRef, useState } from 'react';
import { Ban, Copy, Crown, ExternalLink, Info, Link2, MoreHorizontal, MoreVertical, Power, Send, Settings2 } from 'lucide-react';
import { api } from '../../api.js';
import { Mark } from '../../brand/Brand.jsx';
import { invalidate } from '../../lib/cache.js';
import { haptic, osName } from '../../lib/device.js';
import { inviteUrl, relTime } from '../../lib/format.js';
import { copyNow } from '../../lib/invites.js';
import { useGo } from '../../lib/nav.js';
import { teamName, useTeams } from '../../lib/teams.js';
import { extLinkProps, reminderText, waUrl } from '../../lib/whatsapp.js';
import { inviteMessage, useToast } from '../ui.jsx';
import Sheet, { ActionSheet } from '../m/Sheet.jsx';
import { Chip, Chips } from '../m/List.jsx';

const day = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' });
const dayTime = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const isToday = (d) => new Date(d).toDateString() === new Date().toDateString();
/** Cuándo se envió una invitación de un solo uso: vence 7 días después de entregarse. */
const sentAt = (l) => (l.one_time && l.expires_at ? new Date(Date.parse(l.expires_at) - 7 * 864e5) : new Date(l.created_at));
const fmtSent = (d) => (isToday(d) ? `hoy, ${new Intl.DateTimeFormat('es', { hour: 'numeric', minute: '2-digit' }).format(d)}` : dayTime.format(d));
const expiresIn = (l) => {
  const ms = Date.parse(l.expires_at) - Date.now();
  if (ms < 0) return `venció el ${day.format(new Date(l.expires_at))}`;
  if (ms < 2 * 864e5) return `vence en ${Math.max(1, Math.round(ms / 36e5))} h`;
  return `vence el ${day.format(new Date(l.expires_at))}`;
};

/** Título legible de un enlace: para quién o de qué es (el código sólo en «Detalles»). */
export function linkTitle(l, teams) {
  const team = l.head_id ? teamName(teams.byId.get(l.head_id)) || l.head_name : null;
  if (l.used_at && l.used_by_name) return l.used_by_name;
  // «¿Para quién?» lo escribe quien invita desde la coordinación; las del panel de la cabeza traen su propia etiqueta.
  if (l.one_time && l.label && l.created_by) return `Para ${l.label}`;
  if (l.type_role === 'head') return 'Invitación de cabeza';
  if (l.type_role === 'leader') return team ? `Líder con ${team}` : 'Invitación de líder';
  if (l.kind === 'register') return `${l.type_name}${l.owner_name ? `, con ${l.owner_name}` : ''}`;
  if (l.kind === 'leader') return `Enlace de ${l.owner_name}`;
  return `Invitación personal de ${l.owner_name}`;
}

/** Detalle de un enlace en palabras: cuándo se envió, quién, cuándo vence, quién se registró. */
export function linkMeta(l, teams) {
  if (l.used_at && l.used_by_name) {
    const team = l.head_id && teams ? teamName(teams.byId.get(l.head_id)) || l.head_name : null;
    const as = l.type_role === 'head' ? 'Entró como cabeza' : l.type_role === 'leader' ? `Entró como líder${team ? ` con ${team}` : ''}` : 'Se registró';
    return `${as}, ${relTime(l.used_at)}`;
  }
  if (l.one_time) {
    const by = !l.created_by && l.owner_name ? `Enviada por ${l.owner_name} desde su panel` : `Enviada ${fmtSent(sentAt(l))}`;
    if (l.status !== 'active') return `${by}, anulada${l.disabled_reason && !l.disabled_reason.startsWith('auto:') ? `: ${l.disabled_reason}` : ''}`;
    return `${by}, ${expiresIn(l)}`;
  }
  const uses = `${l.uses} ${l.uses === 1 ? 'registro' : 'registros'}`;
  return `${uses}${l.last_used ? `, el último ${relTime(l.last_used)}` : ''}${l.status !== 'active' ? ', desactivado' : ''}`;
}

/** Hoja para anular o desactivar con motivo: fichas con motivos frecuentes y texto libre (queda en la auditoría). */
export function ReasonSheet({ title, message, reasons, confirmLabel, onConfirm, onClose }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const valid = text.trim().length >= 5;
  return (
    <Sheet title={title} subtitle={message} onClose={onClose}
      footer={({ close }) => (
        <>
          <button type="button" className="btn" onClick={close}>Cancelar</button>
          <button type="button" className="btn btn-danger" disabled={!valid || busy} onClick={async () => {
            setBusy(true); setErr(null);
            try { await onConfirm(text.trim()); haptic('warning'); close(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
          }}>{busy && <span className="spinner" />}{confirmLabel}</button>
        </>
      )}>
      <div className="stack">
        <Chips label="Motivos frecuentes">
          {reasons.map((r) => <Chip key={r} active={text === r} onClick={() => setText(r)}>{r}</Chip>)}
        </Chips>
        <div className="field">
          <label htmlFor="reason-text">Motivo (obligatorio)</label>
          <textarea id="reason-text" className="textarea" value={text} maxLength={300} onChange={(e) => setText(e.target.value)}
            placeholder="Quedará registrado en el historial y la auditoría" />
        </div>
        {err && <div className="alert alert-error" role="alert">{err}</div>}
      </div>
    </Sheet>
  );
}

/** Menú ⋯ de un enlace: reenviar, copiar, ver el formulario, límites, anular o reactivar, detalles. */
export function LinkMenu({ link: l, title, onClose, onLimits, onChanged }) {
  const toast = useToast();
  const teams = useTeams();
  const [sheet, setSheetState] = useState(null);
  // Si una opción abre otra hoja (anular, detalles), el menú no se cierra del todo: pasa a esa hoja.
  const sub = useRef(null);
  const setSheet = (v) => { sub.current = v; setSheetState(v); };
  const url = inviteUrl(l.token);
  const cabeza = l.head_id ? teams.byId.get(l.head_id)?.cabeza_name : null;
  const open = l.status === 'active' && !l.used_at;
  const text = l.one_time
    ? reminderText({ role: l.type_role, name: l.label, cabeza, url })
    : inviteMessage({ url, ownerName: l.owner_name });
  const done = (msg) => { invalidate('links:'); onChanged?.(); toast(msg); };
  if (sheet === 'disable') {
    return (
      <ReasonSheet title={l.one_time ? 'Anular esta invitación' : 'Desactivar enlace'} confirmLabel={l.one_time ? 'Anular' : 'Desactivar'}
        message={l.one_time ? 'Dejará de funcionar de inmediato. Las personas ya registradas no cambian.' : 'Dejará de admitir registros. Las personas ya registradas no cambian.'}
        reasons={l.one_time ? ['Llegó a otra persona', 'Ya no se necesita', 'Error al enviar', 'Otro motivo'] : ['Ya no se usa', 'Se compartió de más', 'Otro motivo']}
        onConfirm={async (reason) => { await api.post(`/links/${l.id}/disable`, { reason }); done(l.one_time ? 'Invitación anulada.' : 'Enlace desactivado.'); }}
        onClose={onClose} />
    );
  }
  if (sheet === 'details') {
    return (
      <Sheet title="Detalles" onClose={onClose}>
        <dl className="kv">
          <dt>Código</dt><dd className="mono selectable">{l.token}</dd>
          <dt>Tipo</dt><dd>{l.type_name || (l.kind === 'leader' ? 'Enlace de líder' : 'Invitación personal')}</dd>
          {l.created_by_name && <><dt>Creado por</dt><dd>{l.created_by_name}</dd></>}
          <dt>Creado</dt><dd>{dayTime.format(new Date(l.created_at))}</dd>
          {l.expires_at && <><dt>Vence</dt><dd>{dayTime.format(new Date(l.expires_at))}</dd></>}
          {l.max_uses ? <><dt>Máximo</dt><dd>{l.max_uses} registros</dd></> : null}
          <dt>Registros</dt><dd>{l.uses}{l.pending ? `, ${l.pending} por aprobar` : ''}</dd>
        </dl>
      </Sheet>
    );
  }
  return (
    <ActionSheet title={title} onClose={() => { if (!sub.current) onClose(); }} groups={[
      [
        { label: l.one_time ? 'Reenviar por WhatsApp' : 'Enviar por WhatsApp', icon: Send, href: waUrl(text), linkProps: extLinkProps(), hidden: !open },
        { label: 'Copiar mensaje', icon: Copy, hidden: !open, onSelect: () => copyNow(text).then((ok) => toast(ok ? 'Mensaje copiado: péguelo en el chat.' : 'No se pudo copiar.', ok ? 'ok' : 'error')) },
        { label: 'Ver formulario', icon: ExternalLink, href: `/registro/${l.token}`, linkProps: { target: '_blank', rel: 'noopener noreferrer' }, hidden: !open },
        { label: 'Límites', icon: Settings2, hidden: !open || l.one_time || !l.can_manage || !onLimits, onSelect: () => onLimits?.(l) },
      ],
      [
        { label: l.one_time ? 'Anular esta invitación' : 'Desactivar enlace', icon: Ban, danger: true, hidden: !open || !l.can_manage, onSelect: () => setSheet('disable') },
        { label: 'Reactivar', icon: Power, hidden: l.status === 'active' || l.one_time || !l.can_manage || (l.kind !== 'register' && l.owner_status !== 'active'),
          onSelect: async () => { try { await api.post(`/links/${l.id}/enable`); done('Enlace reactivado.'); } catch (e) { toast(e.message, 'error'); } } },
        { label: 'Detalles', icon: Info, onSelect: () => setSheet('details') },
      ],
    ]} />
  );
}

/** Fila de un enlace o invitación. Una invitación usada abre la ficha de quien se registró. */
export function LinkRow({ link: l, onLimits, onChanged }) {
  const teams = useTeams();
  const go = useGo();
  const [menu, setMenu] = useState(false);
  const title = linkTitle(l, teams);
  const Icon = l.type_role === 'head' ? Mark : l.type_role === 'leader' || l.kind === 'leader' ? Crown : Link2;
  const More = osName() === 'android' ? MoreVertical : MoreHorizontal;
  const usedPerson = l.used_by_id;
  return (
    <div className={`m-link ${l.status !== 'active' && !l.used_at ? 'is-off' : ''}`} style={{ '--type': l.type_color || 'var(--sky)' }}>
      <button type="button" className="m-row m-link__main" onClick={() => (usedPerson ? go(`/personas/${usedPerson}`) : setMenu(true))}>
        <span className="m-row__lead"><span className={`m-link__icon ${l.type_role === 'head' ? 'is-head' : ''}`}><Icon size={17} aria-hidden="true" /></span></span>
        <span className="m-row__main">
          <span className="m-row__title">{title}</span>
          <span className="m-row__meta">{linkMeta(l, teams)}</span>
        </span>
      </button>
      <button type="button" className="m-icon-btn m-link__more" aria-label={`Opciones: ${title}`} onClick={() => setMenu(true)}><More size={20} /></button>
      {menu && <LinkMenu link={l} title={title} onClose={() => setMenu(false)} onLimits={onLimits} onChanged={onChanged} />}
    </div>
  );
}
