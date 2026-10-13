import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Copy, Crown, Search, Share2, X, AlertCircle, CheckCircle2, Clock, CircleSlash, Ban } from 'lucide-react';
import { api, qs } from '../api.js';
import { STATUS, initials, inviteUrl } from '../lib/format.js';

// ---------------------------------------------------------------- Toasts
const ToastCtx = createContext(() => {});
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((msg, kind = 'ok') => {
    const id = Math.random();
    setItems((x) => [...x, { id, msg, kind }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), kind === 'error' ? 6000 : 3200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.kind === 'error' ? 'error' : ''}`}>
            {t.kind === 'error' ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}
            <span>{t.msg}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// ---------------------------------------------------------------- Modal
export function Modal({ title, subtitle, onClose, children, footer, wide }) {
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
export function Avatar({ name, leader, size }) {
  return <div className={`avatar ${leader ? 'leader' : ''} ${size || ''}`} aria-hidden="true">{initials(name)}</div>;
}

const STATUS_ICON = { active: CheckCircle2, pending: Clock, inactive: CircleSlash, rejected: Ban };
export function StatusBadge({ status }) {
  const s = STATUS[status] || { label: status, tone: 'muted' };
  const Icon = STATUS_ICON[status] || Clock;
  return <span className={`badge badge-${s.tone}`}><Icon size={12} />{s.label}</span>;
}

export function RoleBadge({ isLeader, code }) {
  return isLeader
    ? <span className="badge badge-leader" title="Líder oficial designado"><Crown size={12} />Líder{code ? ` · ${code}` : ''}</span>
    : <span className="badge badge-outline">Persona</span>;
}

export function HeadPill({ name, color }) {
  return <span className="badge badge-outline"><span className="dot" style={{ background: color }} />{name}</span>;
}

export function PersonLink({ id, name, isLeader }) {
  if (!id) return <span className="muted">—</span>;
  return (
    <Link to={`/personas/${id}`} className="row" style={{ display: 'inline-flex', gap: 5 }} onClick={(e) => e.stopPropagation()}>
      {isLeader && <Crown size={12} color="var(--leader)" />}{name}
    </Link>
  );
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

export function ShareLink({ token, ownerName, headName, compact }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const url = inviteUrl(token);
  const message = `Hola, te invito a registrarte en ${headName}${ownerName ? ` (invitación de ${ownerName})` : ''}: ${url}`;
  const copy = async () => {
    if (await copyText(url)) { setCopied(true); toast('Enlace copiado'); setTimeout(() => setCopied(false), 1500); }
  };
  const share = async () => {
    if (navigator.share) { try { await navigator.share({ title: 'Invitación de registro', text: message, url }); } catch { /* cancelado */ } }
    else copy();
  };
  const wa = `https://wa.me/?text=${encodeURIComponent(message)}`;
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="link-box">
        <code title={url}>{compact ? token : url}</code>
        <button className="btn btn-sm" onClick={copy} aria-label="Copiar enlace">{copied ? <Check size={14} /> : <Copy size={14} />}{!compact && 'Copiar'}</button>
      </div>
      <div className="row-wrap">
        <a className="btn btn-sm btn-wa" href={wa} target="_blank" rel="noopener noreferrer">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm5.3 14.2c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .2-3.3-.7-2.8-1.1-4.6-4-4.7-4.2-.1-.2-1.1-1.5-1.1-2.9s.7-2.1 1-2.4c.2-.3.6-.4.8-.4h.6c.2 0 .4 0 .6.5l.9 2.1c.1.2.1.4 0 .6l-.4.6-.4.4c-.1.2-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.4 2.4 1.5.3.1.5.1.7-.1l.9-1.1c.2-.3.4-.2.7-.1l2 1c.3.1.5.2.5.3.1.2.1.7-.1 1.3Z"/></svg>
          WhatsApp
        </a>
        <button className="btn btn-sm" onClick={share}><Share2 size={14} />Compartir</button>
        <a className="btn btn-sm btn-ghost" href={`/registro/${token}`} target="_blank" rel="noopener noreferrer">Abrir formulario</a>
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
        <Avatar name={value.full_name} leader={value.is_leader} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="ellipsis" style={{ fontWeight: 600 }}>{value.full_name}</div>
          <div className="small muted">{value.is_leader ? `Líder · ${value.leader_code || ''}` : value.code}</div>
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
              <Avatar name={p.full_name} leader={p.is_leader} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="ellipsis" style={{ fontWeight: 600 }}>{p.full_name}</div>
                <div className="small muted ellipsis">{p.is_leader ? `Líder · ${p.leader_code}` : p.code} · {p.head_name}{p.inviter_name ? ` · invitado por ${p.inviter_name}` : ''}</div>
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
