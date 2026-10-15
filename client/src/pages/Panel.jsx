import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { AlertCircle, Copy, Crown, Eye, Lock, LogOut, Search, Users } from 'lucide-react';
import { api } from '../api.js';
import { ShareLink, copyText, useToast, WhatsAppIcon } from '../components/ui.jsx';
import InstallHint from '../components/InstallHint.jsx';
import { fmtDate, fmtNum, relTime, inviteUrl, initials } from '../lib/format.js';
import { typeVars } from '../lib/regTypes.js';
import { usePanelManifest } from '../lib/pwa.js';
import { Logo, Mark, JohnPhoto, CAMPAIGN } from '../brand/Brand.jsx';

const pinKey = (token) => `panel-pin:${token.slice(0, 10)}`;
const readPin = (token) => { try { return sessionStorage.getItem(pinKey(token)) || ''; } catch { return ''; } };
const savePin = (token, pin) => { try { if (pin) sessionStorage.setItem(pinKey(token), pin); else sessionStorage.removeItem(pinKey(token)); } catch { /* sin almacenamiento */ } };
const first = (s) => String(s || '').trim().split(/\s+/)[0] || '';

function Stage({ children }) {
  return (
    <header className="pub-stage">
      <JohnPhoto variant="hero" className="stage-photo" eager alt="" />
      <div className="stage-logo-wrap"><Logo tone="sky" className="stage-logo" /></div>
      <div className="stage-inner stage-enter">{children}</div>
    </header>
  );
}

function Foot() {
  return <footer className="pub-foot"><Logo tone="navy" /><span>Equipo {CAMPAIGN} · Santa Marta</span></footer>;
}

/**
 * La cabeza invita a sus líderes: cada envío genera un enlace personal de un solo uso (caduca a los 7 días).
 * Si alguien lo reenvía, nadie más puede registrarse con él.
 */
function LeaderInvites({ token, pin, name, stats, onStats }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState(null);
  const [err, setErr] = useState(null);
  const generate = async () => {
    const r = await api.post(`/public/panel/${encodeURIComponent(token)}/leader-invite`, { pin });
    onStats(r.stats); setLast(r); setErr(null);
    return r;
  };
  const message = (url) => `Hola, soy ${first(name)}. Te invito a ser líder en mi equipo con ${CAMPAIGN}. `
    + `Este link es personal y sirve para una sola persona, no lo reenvíes: ${url}`;
  const sendWhatsApp = async () => {
    // La ventana se abre en el mismo toque (si no, el navegador la bloquea) y luego va a WhatsApp con el enlace nuevo.
    const w = window.open('about:blank', '_blank');
    setBusy(true);
    try {
      const l = await generate();
      const wa = `https://wa.me/?text=${encodeURIComponent(message(inviteUrl(l.token)))}`;
      if (w) { w.opener = null; w.location.href = wa; } else window.location.href = wa;
    } catch (e) { w?.close(); setErr(e); } finally { setBusy(false); }
  };
  const copyNew = async () => {
    setBusy(true);
    try {
      const l = await generate();
      if (await copyText(message(inviteUrl(l.token)))) toast('Invitación copiada: pégala en el chat del futuro líder');
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  return (
    <div className="sheet-card share-card">
      <h3 className="row" style={{ gap: 8 }}><Crown size={19} color="var(--leader)" />Invita a tus líderes</h3>
      <p className="sheet-lead" style={{ marginTop: -6 }}>Cada invitación es personal y sirve para una sola persona. Quien se registre quedará como líder de tu equipo, con su link y su panel.</p>
      <div className="share-actions">
        <button type="button" className="btn btn-lg btn-wa" disabled={busy} onClick={sendWhatsApp}>{busy ? <span className="spinner" /> : <WhatsAppIcon size={20} />}Invitar un líder por WhatsApp</button>
        <button type="button" className="btn" style={{ gridColumn: '1 / -1' }} disabled={busy} onClick={copyNew}><Copy size={16} />Copiar una invitación nueva</button>
      </div>
      {last && <span className="share-url">Última invitación: {inviteUrl(last.token)} · caduca el {fmtDate(last.expires_at)}</span>}
      {stats && (
        <div className="invite-stats">
          <span><b className="tnum">{fmtNum(stats.sent)}</b>enviadas</span>
          <span><b className="tnum">{fmtNum(stats.used)}</b>usadas</span>
          <span><b className="tnum">{fmtNum(stats.open)}</b>por usar</span>
        </div>
      )}
      {err && <div className="alert alert-error" role="alert"><AlertCircle size={16} />{err.message}</div>}
    </div>
  );
}

/** Panel de gestión del líder o de la cabeza: sólo lectura, sin cuenta. Enlace secreto + últimos 4 dígitos de la cédula. */
export default function Panel() {
  const { token } = useParams();
  const [pin, setPin] = useState(() => readPin(token));
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [term, setTerm] = useState('');
  const [rows, setRows] = useState([]);
  const [page, setPage] = useState(1);
  const [inviteStats, setInviteStats] = useState(null);
  const firstRun = useRef(true);
  usePanelManifest(token);

  const load = async ({ p = pin, q = term, pg = 1 } = {}) => {
    setBusy(true);
    try {
      const d = await api.post(`/public/panel/${encodeURIComponent(token)}`, { pin: p, q, page: pg });
      setErr(null);
      savePin(token, p);
      setData((prev) => (pg === 1 && !q ? d : { ...d, leaders: prev?.leaders ?? d.leaders }));
      if (d.leader_invites) setInviteStats(d.leader_invites);
      setPage(pg);
      setRows((r) => (pg === 1 ? d.people.rows : [...r, ...d.people.rows]));
    } catch (e) {
      setErr(e);
      if (e.status === 401 || e.status === 404) { savePin(token, ''); setData(null); }
    } finally { setBusy(false); }
  };

  useEffect(() => { if (pin) load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return undefined; }
    if (!data) return undefined;
    const t = setTimeout(() => load({ q: term }), 300);
    return () => clearTimeout(t);
  }, [term]); // eslint-disable-line react-hooks/exhaustive-deps

  const notFound = err?.status === 404;

  // ---- Entrada con PIN
  if (!data) {
    return (
      <div className="pub">
        <Stage>
          <span className="stage-chip"><i aria-hidden="true" />Panel privado</span>
          <p className="stage-kicker">Equipo {CAMPAIGN}</p>
          <h1 className="stage-title">Tu panel</h1>
          <p className="stage-sub">Mira cómo crece tu red y comparte tu link.</p>
        </Stage>
        <div className="pub-right">
          <main className="pub-sheet">
            <div className="sheet-inner">
              <form className="sheet-card stack" style={{ gap: 16, alignItems: 'stretch' }} onSubmit={(e) => { e.preventDefault(); load({ p: pin }); }}>
                {notFound ? (
                  <div className="state-card warn">
                    <span className="state-icon"><Lock size={24} /></span>
                    <h2 className="sheet-title">Este panel ya no está activo</h2>
                    <p className="sheet-lead">{err.message} Pide un enlace nuevo a tu coordinador.</p>
                  </div>
                ) : (
                  <>
                    <div className="row" style={{ gap: 14 }}>
                      <span className="pin-photo"><JohnPhoto variant="face" eager alt="" /></span>
                      <div>
                        <h2 className="sheet-title">Entra a tu panel</h2>
                        <p className="sheet-lead">Escribe los <b>últimos 4 dígitos de tu cédula</b>.</p>
                      </div>
                    </div>
                    <label className="sr-only" htmlFor="panel-pin">Últimos 4 dígitos de la cédula</label>
                    <input id="panel-pin" className="input pin-input" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                      inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={4} placeholder="••••" autoFocus />
                    {err && <div className="alert alert-error" role="alert"><AlertCircle size={16} />{err.message}</div>}
                    <button className="btn btn-primary btn-lg btn-block" disabled={busy || pin.length !== 4}>{busy ? <span className="spinner" /> : <Eye size={19} />}Ver mi panel</button>
                    <p className="secure-note"><Lock size={13} />Sólo tú puedes verlo: es de solo lectura.</p>
                  </>
                )}
              </form>
            </div>
          </main>
          <Foot />
        </div>
      </div>
    );
  }

  const { person, stats, type, head } = data;
  const isHead = person.is_head;
  const total = data.people.total;
  const team = isHead ? `Equipo ${CAMPAIGN}` : head?.cabeza ? `Equipo de ${head.cabeza}` : `Equipo ${CAMPAIGN}`;
  return (
    <div className="pub" style={typeVars(type?.color || head?.color)}>
      <Stage>
        <span className="stage-chip"><i aria-hidden="true" />Tu panel · solo lectura</span>
        <h1 className="panel-hello">Hola, {first(person.first_names || person.full_name)}</h1>
        <div className="panel-role">
          <span className={`role-pill ${isHead ? 'head' : ''}`}>{isHead ? <Mark size={12} /> : <Crown size={13} />}{isHead ? 'Cabeza' : 'Líder'}</span>
          <span className="panel-team">{team}</span>
        </div>
        <div className="panel-big"><b className="tnum">{fmtNum(stats.total)}</b><span>{isHead ? 'personas en tu equipo' : 'personas en tu red'}</span></div>
      </Stage>
      <div className="pub-right">
        <main className="pub-sheet">
          <div className="sheet-inner">
            {person.status === 'pending' && <div className="alert alert-warn">Tu registro aún está pendiente de aprobación: tu link se activará cuando lo aprueben.</div>}
            <div className="panel-stats">
              {isHead && <div className="panel-stat"><b className="tnum">{fmtNum(stats.leaders)}</b><span>líderes</span></div>}
              <div className="panel-stat"><b className="tnum">{fmtNum(stats.direct)}</b><span>{isHead ? 'directos contigo' : 'invitadas por ti'}</span></div>
              <div className="panel-stat"><b className="tnum">{fmtNum(stats.last7)}</b><span>en 7 días</span></div>
              <div className="panel-stat"><b className="tnum">{fmtNum(stats.last30)}</b><span>en 30 días</span></div>
              <div className="panel-stat"><b className="tnum">{fmtNum(stats.supports_yes)}</b><span>dicen «cuenten conmigo»</span></div>
              <div className="panel-stat"><b className="tnum">{fmtNum(stats.secure_votes)}</b><span>votos seguros</span></div>
            </div>

            {isHead && <LeaderInvites token={token} pin={pin} name={person.full_name} stats={inviteStats} onStats={setInviteStats} />}

            {isHead && data.leaders && (
              <div className="sheet-card">
                <h3 className="row" style={{ gap: 8, fontFamily: 'var(--font-display)', fontSize: 19, marginBottom: 6 }}><Users size={19} />Tus líderes <span className="muted small" style={{ fontFamily: 'var(--font-ui)', fontWeight: 400 }}>{fmtNum(data.leaders.length)}</span></h3>
                {data.leaders.length === 0 && <p className="text-2" style={{ margin: 0 }}>Todavía no tienes líderes. Invita al primero: cada líder suma a su propia gente.</p>}
                {data.leaders.map((l) => (
                  <div key={l.id} className="leader-row">
                    <span className="avatar leader" aria-hidden="true">{initials(l.full_name)}</span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="ellipsis" style={{ fontWeight: 600 }}>{l.full_name}</div>
                      <div className="small muted">{l.status === 'pending' ? 'Pendiente de aprobación' : `Líder desde el ${fmtDate(l.created_at)}`}</div>
                    </div>
                    <div className="num"><b className="tnum">{fmtNum(l.network)}</b><span>{l.last7 > 0 ? `+${fmtNum(l.last7)} esta semana` : 'en su red'}</span></div>
                  </div>
                ))}
              </div>
            )}

            {data.invite_token && (
              <div className="sheet-card share-card">
                <h3>Invita personas</h3>
                <p className="sheet-lead" style={{ marginTop: -6 }}>Quienes se registren con tu link quedarán contigo y aparecerán aquí.</p>
                <ShareLink token={data.invite_token} ownerName={person.full_name} asOwner big />
              </div>
            )}

            <div className="sheet-card" style={{ padding: 0 }}>
              <div className="stack" style={{ gap: 10, padding: '18px 18px 10px' }}>
                <h3 className="row" style={{ gap: 8, fontFamily: 'var(--font-display)', fontSize: 19 }}><Users size={19} />{isHead ? 'Tu equipo' : 'Tu red'} <span className="muted small" style={{ fontFamily: 'var(--font-ui)', fontWeight: 400 }}>{fmtNum(total)}</span></h3>
                <div className="search-input"><Search size={16} />
                  <input className="input" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Buscar por nombre" aria-label={isHead ? 'Buscar en mi equipo' : 'Buscar en mi red'} /></div>
              </div>
              {rows.length === 0 && <p className="text-2" style={{ margin: 0, padding: '4px 18px 18px' }}>{term ? 'Nadie coincide con la búsqueda.' : 'Aún no se ha registrado nadie con tu link. ¡Compártelo!'}</p>}
              <ul className="panel-list">
                {rows.map((r) => (
                  <li key={r.id}>
                    <span className="dot" style={{ background: r.type_color || 'var(--muted)', width: 10, height: 10 }} title={r.type_name} />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="row" style={{ gap: 6 }}><b className="ellipsis" style={{ fontWeight: 600 }}>{r.full_name}</b>{r.is_leader && <Crown size={13} color="var(--leader)" aria-label="Líder" />}
                        {r.status === 'pending' && <span className="badge badge-warning">Pendiente</span>}</div>
                      <div className="small muted ellipsis">
                        {[r.barrio || r.localidad, r.direct ? 'Directo contigo' : r.inviter_name ? `Con ${r.inviter_name}` : null].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                    <div className="small muted nowrap" style={{ textAlign: 'right' }} title={fmtDate(r.created_at)}>{relTime(r.created_at)}
                      <div className="mono">{r.phone}</div></div>
                  </li>
                ))}
              </ul>
              {rows.length < total && (
                <div style={{ padding: '0 18px 18px' }}>
                  <button className="btn btn-block" disabled={busy} onClick={() => load({ pg: page + 1 })}>{busy && <span className="spinner" />}Ver más</button>
                </div>
              )}
            </div>

            <InstallHint what="tu panel" storageKey="panel" />
            <p className="secure-note" style={{ textAlign: 'center' }}>Este panel es privado y de solo lectura. Si crees que alguien más tiene tu enlace, pide uno nuevo a tu coordinador.</p>
            <button className="btn btn-ghost" onClick={() => { savePin(token, ''); setPin(''); setData(null); setRows([]); }}><LogOut size={16} />Salir</button>
          </div>
        </main>
        <Foot />
      </div>
    </div>
  );
}
