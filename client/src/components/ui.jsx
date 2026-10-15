import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { Check, Copy, Crown, Search, Share2, X, AlertCircle, CheckCircle2, Clock, CircleSlash, Ban, ExternalLink } from 'lucide-react';
import { api, qs } from '../api.js';
import { STATUS, initials, inviteUrl } from '../lib/format.js';
import { Mark, CAMPAIGN, JohnPhoto } from '../brand/Brand.jsx';
import { extLinkProps, waUrl } from '../lib/whatsapp.js';
import Sheet from './m/Sheet.jsx';

// ---------------------------------------------------------------- Toasts
// Avisos breves. Van fuera de #root: siguen tocables mientras una hoja deja el resto de la app inactivo.
// toast(mensaje, 'ok' | 'error', { action: { label, onClick }, duration })
const ToastCtx = createContext(() => {});
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const dismiss = useCallback((id) => setItems((x) => x.filter((t) => t.id !== id)), []);
  const push = useCallback((msg, kind = 'ok', opts = {}) => {
    const id = Math.random();
    setItems((x) => [...x.slice(-2), { id, msg, kind, action: opts.action }]);
    setTimeout(() => dismiss(id), opts.duration ?? (kind === 'error' || opts.action ? 6000 : 3200));
    return id;
  }, [dismiss]);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      {createPortal(
        <div className="toasts" role="status" aria-live="polite">
          {items.map((t) => (
            <div key={t.id} className={`toast ${t.kind === 'error' ? 'error' : ''}`}>
              {t.kind === 'error' ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}
              <span>{t.msg}</span>
              {t.action && <button type="button" className="toast-action" onClick={() => { dismiss(t.id); t.action.onClick(); }}>{t.action.label}</button>}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// ---------------------------------------------------------------- Modal
/** En la app del celular, los diálogos son hojas que suben desde abajo (mismas propiedades). */
export function Modal(props) {
  if (typeof document !== 'undefined' && document.documentElement.classList.contains('m-phone')) {
    const { title, subtitle, onClose, children, footer } = props;
    return <Sheet title={title} subtitle={subtitle} onClose={onClose} footer={footer} size={props.wide ? 'large' : 'auto'}>{children}</Sheet>;
  }
  return <CenteredModal {...props} />;
}

function CenteredModal({ title, subtitle, onClose, children, footer, wide }) {
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="btn btn-ghost btn-sm btn-icon" onClick={onClose} aria-label="Cerrar"><X size={18} /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/** Confirmación con motivo opcional/obligatorio. */
export function ConfirmModal({ title, message, confirmLabel = 'Confirmar', danger, reason, reasonRequired, onConfirm, onClose }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const go = async () => {
    setBusy(true); setErr(null);
    try { await onConfirm(text); onClose(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal title={title} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Cancelar</button>
      <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} disabled={busy || (reasonRequired && text.trim().length < 5)} onClick={go}>
        {busy && <span className="spinner" />} {confirmLabel}
      </button>
    </>}>
      <div className="stack">
        {message && <div className="text-2">{message}</div>}
        {reason && (
          <div className="field">
            <label htmlFor="reason">Motivo {reasonRequired ? '(obligatorio)' : '(opcional)'}</label>
            <textarea id="reason" className="textarea" value={text} onChange={(e) => setText(e.target.value)} maxLength={300}
              placeholder="Quedará registrado en el historial y la auditoría" />
          </div>
        )}
        {err && <div className="alert alert-error"><AlertCircle size={16} />{err}</div>}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- Small pieces
export function Avatar({ name, leader, head, size }) {
  return <div className={`avatar ${head ? 'head' : leader ? 'leader' : ''} ${size || ''}`} aria-hidden="true">{initials(name)}</div>;
}

/** Ícono del papel: doble ángulo para la cabeza, corona para el líder. */
export function RoleIcon({ isHead, isLeader, size = 13 }) {
  if (isHead) return <Mark size={size} className="role-icon" title="Cabeza" />;
  if (isLeader) return <Crown size={size} color="var(--leader)" aria-label="Líder" />;
  return null;
}

const STATUS_ICON = { active: CheckCircle2, pending: Clock, inactive: CircleSlash, rejected: Ban };
export function StatusBadge({ status }) {
  const s = STATUS[status] || { label: status, tone: 'muted' };
  const Icon = STATUS_ICON[status] || Clock;
  return <span className={`badge badge-${s.tone}`}><Icon size={12} />{s.label}</span>;
}

export function RoleBadge({ isLeader, isHead, code }) {
  if (isHead) return <span className="badge badge-head" title="Cabeza de su estructura: invita líderes y personas"><Mark size={11} />Cabeza</span>;
  return isLeader
    ? <span className="badge badge-leader" title="Líder oficial designado"><Crown size={12} />Líder{code ? <span className="mono" style={{ fontSize: 11, fontWeight: 500 }}>{code}</span> : null}</span>
    : <span className="badge badge-outline">Persona</span>;
}

export function HeadPill({ name, color }) {
  return <span className="badge badge-outline"><span className="dot" style={{ background: color }} />{name}</span>;
}

export function PersonLink({ id, name, isLeader, isHead }) {
  if (!id) return <span className="muted">—</span>;
  return (
    <Link to={`/personas/${id}`} className="row" style={{ display: 'inline-flex', gap: 5 }} onClick={(e) => e.stopPropagation()}>
      <RoleIcon isHead={isHead} isLeader={isLeader} size={12} />{name}
    </Link>
  );
}

/**
 * John Thowinsson, de quien cuelgan todas las cabezas: su foto y su nombre. Lleva a la red completa (y, con
 * `locate`, ubica allí a esa persona); `plain`, sin enlace.
 */
export function JohnLink({ locate, plain }) {
  const inner = <><span className="john-link__photo"><JohnPhoto sizes="22px" alt="" /></span>{CAMPAIGN}</>;
  if (plain) return <span className="john-link">{inner}</span>;
  return <Link to={`/arbol${locate ? `?persona=${locate}` : ''}`} className="john-link" onClick={(e) => e.stopPropagation()}>{inner}</Link>;
}

export function Spinner() { return <span className="spinner" aria-label="Cargando" />; }
export function Loading() { return <div className="loading-block"><Spinner /></div>; }
export function Empty({ icon: Icon, title, children }) {
  return <div className="empty">{Icon && <Icon size={28} />}<b style={{ color: 'var(--text-2)' }}>{title}</b>{children}</div>;
}
export function ErrorBox({ error }) {
  if (!error) return null;
  return <div className="alert alert-error"><AlertCircle size={16} /><span>{error.message || String(error)}</span></div>;
}

export function StatTile({ icon: Icon, label, value, sub }) {
  return (
    <div className="card stat">
      <div className="label">{Icon && <Icon size={16} />}{label}</div>
      <div className="value">{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- Copy / share
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy'); ta.remove(); return ok;
  }
}

export function WhatsAppIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm5.3 14.2c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .2-3.3-.7-2.8-1.1-4.6-4-4.7-4.2-.1-.2-1.1-1.5-1.1-2.9s.7-2.1 1-2.4c.2-.3.6-.4.8-.4h.6c.2 0 .4 0 .6.5l.9 2.1c.1.2.1.4 0 .6l-.4.6-.4.4c-.1.2-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.4 2.4 1.5.3.1.5.1.7-.1l.9-1.1c.2-.3.4-.2.7-.1l2 1c.3.1.5.2.5.3.1.2.1.7-.1 1.3Z"/></svg>
  );
}

const firstWord = (s) => String(s || '').trim().split(/\s+/)[0] || '';

/**
 * Mensaje para invitar por WhatsApp. Habla de la campaña y de quien invita, nunca de nombres internos
 * de la estructura («Cabeza …»). asOwner: lo comparte el propio dueño del enlace.
 */
export function inviteMessage({ url, ownerName, asOwner }) {
  if (asOwner && ownerName) return `Hola, soy ${firstWord(ownerName)}. Te invito a sumarte al equipo de ${CAMPAIGN}. Regístrate aquí, es rápido: ${url}`;
  return `Hola, te invito a sumarte al equipo de ${CAMPAIGN}${ownerName ? ` con ${ownerName}` : ''}. Regístrate aquí, es rápido: ${url}`;
}

export function ShareLink({ token, ownerName, compact, asOwner, big }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const url = inviteUrl(token);
  const message = inviteMessage({ url, ownerName, asOwner });
  const copy = async () => {
    if (await copyText(url)) { setCopied(true); toast('Enlace copiado'); setTimeout(() => setCopied(false), 1500); }
  };
  const share = async () => {
    if (navigator.share) { try { await navigator.share({ title: `Equipo ${CAMPAIGN}`, text: message }); } catch { /* cancelado */ } }
    else copy();
  };
  // En la app instalada del iPhone abre WhatsApp directo; en el celular, en la misma ventana.
  const wa = waUrl(message);
  if (big) {
    return (
      <div className="stack" style={{ gap: 10 }}>
        <div className="share-actions">
          <a className="btn btn-lg btn-wa" href={wa} {...extLinkProps()}><WhatsAppIcon size={20} />Enviar por WhatsApp</a>
          <button type="button" className="btn" onClick={copy}>{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? 'Copiado' : 'Copiar link'}</button>
          <button type="button" className="btn" onClick={share}><Share2 size={16} />Compartir</button>
        </div>
        <span className="share-url">{url}</span>
      </div>
    );
  }
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="link-box">
        <code title={url}>{compact ? token : url}</code>
        <button type="button" className="btn btn-sm" onClick={copy} aria-label="Copiar enlace">{copied ? <Check size={14} /> : <Copy size={14} />}{!compact && 'Copiar'}</button>
      </div>
      <div className="row-wrap">
        <a className="btn btn-sm btn-wa" href={wa} {...extLinkProps()}><WhatsAppIcon size={14} />WhatsApp</a>
        <button type="button" className="btn btn-sm" onClick={share}><Share2 size={14} />Compartir</button>
        <a className="btn btn-sm btn-ghost" href={`/registro/${token}`} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} />Ver formulario</a>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Person picker
export function PersonPicker({ headId, value, onChange, placeholder = 'Buscar persona…', filter, disabled }) {
  const [term, setTerm] = useState('');
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [hl, setHl] = useState(0);
  const timer = useRef();
  useEffect(() => {
    clearTimeout(timer.current);
    if (term.trim().length < 2) { setItems([]); return; }
    timer.current = setTimeout(async () => {
      try {
        const r = await api.get(`/search${qs({ q: term, head_id: headId })}`);
        setItems(filter ? r.filter(filter) : r);
        setHl(0);
      } catch { setItems([]); }
    }, 200);
    return () => clearTimeout(timer.current);
  }, [term, headId, filter]);

  if (value) {
    return (
      <div className="link-box" style={{ borderStyle: 'solid' }}>
        <Avatar name={value.full_name} leader={value.is_leader} head={value.is_head} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="ellipsis" style={{ fontWeight: 600 }}>{value.full_name}</div>
          <div className="small muted">{value.is_head ? 'Cabeza' : value.is_leader ? `Líder · ${value.leader_code || ''}` : value.code}</div>
        </div>
        {!disabled && <button type="button" className="btn btn-sm btn-ghost btn-icon" onClick={() => onChange(null)} aria-label="Quitar"><X size={16} /></button>}
      </div>
    );
  }
  return (
    <div className="search-input" style={{ position: 'relative' }}>
      <Search size={16} />
      <input className="input" value={term} disabled={disabled} placeholder={placeholder}
        onChange={(e) => { setTerm(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { setHl((h) => Math.min(h + 1, items.length - 1)); e.preventDefault(); }
          if (e.key === 'ArrowUp') { setHl((h) => Math.max(h - 1, 0)); e.preventDefault(); }
          if (e.key === 'Enter' && items[hl]) { onChange(items[hl]); setTerm(''); e.preventDefault(); }
        }} />
      {open && items.length > 0 && (
        <div className="dropdown">
          {items.map((p, i) => (
            <button type="button" key={p.id} className={`dropdown-item ${i === hl ? 'hl' : ''}`} onMouseDown={() => { onChange(p); setTerm(''); }}>
              <Avatar name={p.full_name} leader={p.is_leader} head={p.is_head} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="ellipsis" style={{ fontWeight: 600 }}>{p.full_name}</div>
                <div className="small muted ellipsis">{p.is_head ? 'Cabeza' : p.is_leader ? `Líder · ${p.leader_code}` : p.code} · {p.head_name}{p.inviter_name ? ` · invitado por ${p.inviter_name}` : ''}</div>
              </div>
              {p.status !== 'active' && <StatusBadge status={p.status} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function useAsync(fn, deps) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    fn().then((data) => alive && setState({ loading: false, data, error: null }))
      .catch((error) => alive && setState({ loading: false, data: null, error }));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, reload: () => setTick((t) => t + 1) };
}

/** Ubicación de una persona: "Localidad 2 › Comuna 3 › Pescaíto", marcando lo escrito a mano. */
export function LocationText({ loc, compact }) {
  if (!loc || !loc.localidad) return <span className="muted">Sin ubicación</span>;
  const part = (x, kind) => (x.manual !== undefined
    ? <span title="Escrito a mano: pendiente de verificación" style={{ color: 'var(--warning-text)' }}>{x.manual}*</span>
    : <span title={x.alias || kind}>{x.name}{!compact && x.kind === 'corregimiento' ? ' (corr.)' : ''}</span>);
  const parts = ['localidad', 'comuna', 'barrio'].filter((l) => loc[l]).map((l) => part(loc[l], l));
  return (
    <span className="row-wrap" style={{ gap: 4, display: 'inline-flex' }}>
      {parts.map((p, i) => <span key={i} className="row" style={{ gap: 4 }}>{i > 0 && <span className="muted">›</span>}{p}</span>)}
      {loc.status === 'pending' && <span className="badge badge-geo-pending">Por verificar</span>}
    </span>
  );
}
