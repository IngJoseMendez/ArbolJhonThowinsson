import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { AlertCircle, Crown, Eye, KeyRound, LogOut, Search, Users } from 'lucide-react';
import { api } from '../api.js';
import { ShareLink } from '../components/ui.jsx';
import { fmtDate, fmtNum, relTime } from '../lib/format.js';
import { typeVars } from '../lib/regTypes.js';

const pinKey = (token) => `panel-pin:${token.slice(0, 10)}`;
const readPin = (token) => { try { return sessionStorage.getItem(pinKey(token)) || ''; } catch { return ''; } };
const savePin = (token, pin) => { try { if (pin) sessionStorage.setItem(pinKey(token), pin); else sessionStorage.removeItem(pinKey(token)); } catch { /* sin almacenamiento */ } };

/** Panel de gestión del líder: sólo lectura, sin cuenta. Enlace secreto + últimos 4 dígitos de la cédula. */
export default function Panel() {
  const { token } = useParams();
  const [pin, setPin] = useState(() => readPin(token));
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [term, setTerm] = useState('');
  const [rows, setRows] = useState([]);
  const [page, setPage] = useState(1);
  const first = useRef(true);

  const load = async ({ p = pin, q = term, pg = 1 } = {}) => {
    setBusy(true);
    try {
      const d = await api.post(`/public/panel/${encodeURIComponent(token)}`, { pin: p, q, page: pg });
      setErr(null);
      savePin(token, p);
      setData(d);
      setPage(pg);
      setRows((r) => (pg === 1 ? d.people.rows : [...r, ...d.people.rows]));
    } catch (e) {
      setErr(e);
      if (e.status === 401 || e.status === 404) { savePin(token, ''); setData(null); }
    } finally { setBusy(false); }
  };

  useEffect(() => { if (pin) load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (first.current) { first.current = false; return undefined; }
    if (!data) return undefined;
    const t = setTimeout(() => load({ q: term }), 300);
    return () => clearTimeout(t);
  }, [term]); // eslint-disable-line react-hooks/exhaustive-deps

  const notFound = err?.status === 404;
  const color = data?.type?.color || data?.head?.color;

  if (!data) {
    return (
      <div className="public-wrap">
        <div className="public-card">
          <form className="card card-pad stack" style={{ gap: 14 }} onSubmit={(e) => { e.preventDefault(); load({ p: pin }); }}>
            <div className="hero-icon" style={{ margin: '4px auto 0' }}><KeyRound size={22} /></div>
            <h2 style={{ textAlign: 'center' }}>Panel de gestión</h2>
            {notFound ? (
              <div className="alert alert-error"><AlertCircle size={16} /><span>{err.message} Pida un enlace nuevo a su coordinador.</span></div>
            ) : (
              <>
                <p className="text-2" style={{ margin: 0, textAlign: 'center' }}>Escriba los <b>últimos 4 dígitos de su cédula</b> para ver su gestión.</p>
                <input className="input pin-input" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  inputMode="numeric" autoComplete="off" pattern="[0-9]*" maxLength={4} placeholder="••••" aria-label="Últimos 4 dígitos de la cédula" autoFocus />
                {err && <div className="alert alert-error" role="alert"><AlertCircle size={16} />{err.message}</div>}
                <button className="btn btn-primary" disabled={busy || pin.length !== 4}>{busy ? <span className="spinner" /> : <Eye size={18} />}Ver mi gestión</button>
              </>
            )}
          </form>
        </div>
      </div>
    );
  }

  const { person, stats, type, head } = data;
  const total = data.people.total;
  return (
    <div className="public-wrap" style={typeVars(color)}>
      <div className="public-card typed stack" style={{ gap: 14 }}>
        <div className="type-banner">
          <span className="type-banner-kicker">Mi gestión · solo lectura</span>
          <span className="type-banner-name row" style={{ gap: 8 }}>{person.is_leader && <Crown size={18} />}{person.full_name}</span>
          <span className="type-banner-sub">{type?.name}{person.leader_code ? ` · ${person.leader_code}` : ''} · {head?.name}</span>
        </div>
        {person.status === 'pending' && <div className="alert alert-warn small">Su registro aún está pendiente de aprobación: su enlace se activará cuando lo aprueben.</div>}
        <div className="panel-stats">
          <div className="panel-stat big"><b className="tnum">{fmtNum(stats.total)}</b><span>personas en tu red</span></div>
          <div className="panel-stat"><b className="tnum">{fmtNum(stats.direct)}</b><span>invitadas por ti</span></div>
          <div className="panel-stat"><b className="tnum">{fmtNum(stats.last7)}</b><span>últimos 7 días</span></div>
          <div className="panel-stat"><b className="tnum">{fmtNum(stats.last30)}</b><span>últimos 30 días</span></div>
          <div className="panel-stat"><b className="tnum">{fmtNum(stats.supports_yes)}</b><span>dicen «cuenten conmigo»</span></div>
        </div>
        {data.invite_token && (
          <div className="card card-pad stack" style={{ gap: 10 }}>
            <h3>Comparte tu link para unir más personas</h3>
            <ShareLink token={data.invite_token} ownerName={person.full_name} headName={head?.name} />
          </div>
        )}
        <div className="card">
          <div className="card-pad stack" style={{ gap: 10, paddingBottom: 8 }}>
            <h3 className="row" style={{ gap: 8 }}><Users size={18} />Tu red <span className="muted small" style={{ fontWeight: 400 }}>({fmtNum(total)})</span></h3>
            <div className="search-input"><Search size={16} />
              <input className="input" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Buscar por nombre" aria-label="Buscar en mi red" /></div>
          </div>
          {rows.length === 0 && <p className="muted small card-pad" style={{ margin: 0 }}>{term ? 'Nadie coincide con la búsqueda.' : 'Aún no se ha registrado nadie con tu link. ¡Compártelo!'}</p>}
          <ul className="panel-list">
            {rows.map((r) => (
              <li key={r.id}>
                <span className="dot" style={{ background: r.type_color || 'var(--muted)', width: 10, height: 10 }} title={r.type_name} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="row" style={{ gap: 6 }}><b className="ellipsis">{r.full_name}</b>{r.is_leader && <Crown size={13} color="var(--leader)" />}
                    {r.status === 'pending' && <span className="badge badge-warning">Pendiente</span>}</div>
                  <div className="small muted ellipsis">
                    {[r.barrio || r.localidad, r.direct ? 'Invitado por ti' : r.inviter_name ? `Por ${r.inviter_name}` : null, r.type_name].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <div className="small muted nowrap" style={{ textAlign: 'right' }} title={fmtDate(r.created_at)}>{relTime(r.created_at)}
                  <div className="mono">{r.phone}</div></div>
              </li>
            ))}
          </ul>
          {rows.length < total && (
            <div className="card-pad" style={{ paddingTop: 0 }}>
              <button className="btn" style={{ width: '100%' }} disabled={busy} onClick={() => load({ pg: page + 1 })}>{busy && <span className="spinner" />}Ver más</button>
            </div>
          )}
        </div>
        <p className="small muted" style={{ textAlign: 'center', margin: 0 }}>
          Este panel es de solo lectura y privado. Si crees que alguien más tiene tu enlace, pide uno nuevo a tu coordinador.
        </p>
        <button className="btn btn-ghost" onClick={() => { savePin(token, ''); setPin(''); setData(null); setRows([]); }}><LogOut size={16} />Salir</button>
      </div>
    </div>
  );
}
