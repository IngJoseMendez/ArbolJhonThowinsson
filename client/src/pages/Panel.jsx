import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { AlertCircle, Copy, Crown, Eye, Lock, LogOut, Search, Users, X } from 'lucide-react';
import { api } from '../api.js';
import { copyText, inviteMessage, useToast, WhatsAppIcon } from '../components/ui.jsx';
import InstallHint from '../components/InstallHint.jsx';
import { fmtDate, fmtNum, relTime, inviteUrl, initials } from '../lib/format.js';
import { typeVars } from '../lib/regTypes.js';
import { usePanelManifest } from '../lib/pwa.js';
import { readPin, savePin, isNewPanel, clearNewPanel } from '../lib/panelSession.js';
import { Logo, Mark, JohnPhoto, CAMPAIGN } from '../brand/Brand.jsx';

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
 * Botones para invitar a un líder: cada envío genera un enlace personal de un solo uso (caduca a los 7 días).
 * Si alguien lo reenvía, nadie más puede registrarse con él.
 */
function LeaderInviteActions({ token, pin, name, stats, onStats }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const generate = async () => {
    const r = await api.post(`/public/panel/${encodeURIComponent(token)}/leader-invite`, { pin });
    onStats(r.stats); setErr(null);
    return r;
  };
  const message = (url) => `Hola, soy ${first(name)}. Te invito a ser líder en mi equipo con ${CAMPAIGN}. `
    + `Este link es solo para ti, no lo reenvíes: ${url}`;
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
      if (await copyText(message(inviteUrl(l.token)))) toast('Invitación copiada: pégala en el chat de tu líder');
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  return (
    <>
      <div className="grow-actions">
        <button type="button" className="btn btn-wa" disabled={busy} onClick={sendWhatsApp}>{busy ? <span className="spinner" /> : <WhatsAppIcon size={17} />}Invitar un líder</button>
        <button type="button" className="btn" disabled={busy} onClick={copyNew}><Copy size={16} />Copiar</button>
      </div>
      {stats?.sent > 0 && <span className="grow-meta">{fmtNum(stats.sent)} enviadas · {fmtNum(stats.used)} usadas · {fmtNum(stats.open)} sin usar</span>}
      {err && <div className="alert alert-error" role="alert" style={{ marginTop: 8 }}><AlertCircle size={16} />{err.message}</div>}
    </>
  );
}

/** Botones para enviar el propio link de invitación de personas (WhatsApp o copiar para cualquier otra app). */
function MyLinkActions({ token, name }) {
  const toast = useToast();
  const url = inviteUrl(token);
  const message = inviteMessage({ url, ownerName: name, asOwner: true });
  const copy = async () => { if (await copyText(message)) toast('Invitación copiada: pégala donde quieras'); };
  return (
    <div className="grow-actions">
      <a className="btn btn-wa" href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener noreferrer"><WhatsAppIcon size={17} />Enviar mi link</a>
      <button type="button" className="btn" onClick={copy}><Copy size={16} />Copiar</button>
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
  const [tab, setTab] = useState('lideres');
  const [fresh, setFresh] = useState(() => isNewPanel(token));
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
  const leaders = data.leaders || [];
  const view = isHead ? tab : 'red';
  const team = isHead ? `Equipo ${CAMPAIGN}` : head?.cabeza ? `Equipo de ${head.cabeza}` : `Equipo ${CAMPAIGN}`;
  const peopleList = (
    <>
      <div className="search-input" style={{ margin: '4px 0 6px' }}><Search size={16} />
        <input className="input" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Buscar por nombre" aria-label={isHead ? 'Buscar en mi equipo' : 'Buscar en mi red'} /></div>
      {rows.length === 0 && <p className="text-2" style={{ margin: '8px 0 0' }}>{term ? 'Nadie coincide con la búsqueda.' : 'Aún no se ha registrado nadie. ¡Comparte tu link!'}</p>}
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
      {rows.length < total && <button className="btn btn-block" style={{ marginTop: 12 }} disabled={busy} onClick={() => load({ pg: page + 1 })}>{busy && <span className="spinner" />}Ver más</button>}
    </>
  );
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
            {fresh && (
              <div className="save-panel" role="note">
                <div style={{ minWidth: 0, flex: 1 }}>
                  <b>Esta página es tu panel</b>
                  <span>Para volver, abre el mismo link con el que te registraste, o guárdalo aquí.</span>
                  <a className="btn btn-sm btn-wa" href={`https://wa.me/?text=${encodeURIComponent(`Mi panel del equipo ${CAMPAIGN} (privado, no reenviar): ${window.location.origin}/panel/${token}`)}`}
                    target="_blank" rel="noopener noreferrer" onClick={() => { clearNewPanel(token); setFresh(false); }}><WhatsAppIcon size={15} />Guardar en mi WhatsApp</a>
                </div>
                <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label="Cerrar" onClick={() => { clearNewPanel(token); setFresh(false); }}><X size={16} /></button>
              </div>
            )}
            {person.status === 'pending' && <div className="alert alert-warn">Tu registro aún está pendiente de aprobación: tu link se activará cuando lo aprueben.</div>}
            <div className="panel-strip">
              {isHead
                ? <div><b className="tnum">{fmtNum(stats.leaders)}</b><span>líderes</span></div>
                : <div><b className="tnum">{fmtNum(stats.direct)}</b><span>invitaste tú</span></div>}
              <div><b className="tnum">+{fmtNum(stats.last7)}</b><span>esta semana</span></div>
              <div><b className="tnum">{fmtNum(stats.supports_yes)}</b><span>«cuenten conmigo»</span></div>
            </div>

            {/* Cómo crece la red, en pasos cortos, con la acción donde toca. */}
            <section className="sheet-card grow">
              <h2 className="sheet-title">{isHead ? 'Así crece tu equipo' : 'Así crece tu red'}</h2>
              <ol className="grow-steps">
                {isHead ? (
                  <>
                    <li>
                      <b>Invita a tus líderes</b>
                      <span>Un link personal para cada uno.</span>
                      <LeaderInviteActions token={token} pin={pin} name={person.full_name} stats={inviteStats} onStats={setInviteStats} />
                    </li>
                    <li><b>Tus líderes invitan a su gente</b><span>Cada uno comparte su link y tu equipo crece.</span></li>
                    <li><b>Cada persona invita a más</b><span>Al registrarse recibe su propio link.</span></li>
                  </>
                ) : (
                  <>
                    <li>
                      <b>Comparte tu link</b>
                      <span>Quien se registre queda en tu red.</span>
                      {data.invite_token && <MyLinkActions token={data.invite_token} name={person.full_name} />}
                    </li>
                    <li><b>Cada persona invita a más</b><span>Al registrarse recibe su propio link: todo suma a tu red.</span></li>
                  </>
                )}
              </ol>
              {isHead && data.invite_token && (
                <div className="grow-also">
                  <span><b>¿Quieres sumar a alguien tú mismo?</b> Envía tu link de personas.</span>
                  <MyLinkActions token={data.invite_token} name={person.full_name} />
                </div>
              )}
            </section>

            {/* Menú: líderes y equipo (la cabeza) o la red (el líder). */}
            <section className="sheet-card">
              {isHead ? (
                <div className="seg full" role="tablist" aria-label="Ver">
                  <button type="button" role="tab" aria-selected={view === 'lideres'} className={view === 'lideres' ? 'active' : ''} onClick={() => setTab('lideres')}>
                    <Crown size={15} />Líderes <span className="seg-count tnum">{fmtNum(leaders.length)}</span></button>
                  <button type="button" role="tab" aria-selected={view === 'red'} className={view === 'red' ? 'active' : ''} onClick={() => setTab('red')}>
                    <Users size={15} />Equipo <span className="seg-count tnum">{fmtNum(stats.total)}</span></button>
                </div>
              ) : (
                <h2 className="sheet-title row" style={{ gap: 8 }}><Users size={19} />Tu red <span className="seg-count tnum">{fmtNum(stats.total)}</span></h2>
              )}
              {view === 'lideres' ? (
                <div className="leader-list">
                  {leaders.length === 0 && <p className="text-2" style={{ margin: '12px 0 0' }}>Aún no tienes líderes. Invita al primero arriba.</p>}
                  {leaders.map((l) => (
                    <div key={l.id} className="leader-row">
                      <span className="avatar leader" aria-hidden="true">{initials(l.full_name)}</span>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div className="ellipsis" style={{ fontWeight: 600 }}>{l.full_name}</div>
                        <div className="small muted">{l.status === 'pending' ? 'Pendiente de aprobación' : l.last7 > 0 ? `+${fmtNum(l.last7)} esta semana` : `Desde el ${fmtDate(l.created_at)}`}</div>
                      </div>
                      <div className="num"><b className="tnum">{fmtNum(l.network)}</b><span>en su red</span></div>
                    </div>
                  ))}
                </div>
              ) : peopleList}
            </section>

            <InstallHint what="tu panel" storageKey="panel" />
            <p className="secure-note" style={{ textAlign: 'center' }}>Panel privado y de solo lectura. Si alguien más tiene tu enlace, pide uno nuevo a tu coordinador.</p>
            <button className="btn btn-ghost" onClick={() => { savePin(token, ''); clearNewPanel(token); setPin(''); setData(null); setRows([]); }}><LogOut size={16} />Salir</button>
          </div>
        </main>
        <Foot />
      </div>
    </div>
  );
}
