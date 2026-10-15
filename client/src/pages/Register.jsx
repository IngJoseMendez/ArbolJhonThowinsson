import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { AlertCircle, Clock, Lock, Link2Off, UserPlus } from 'lucide-react';
import { api } from '../api.js';
import { ShareLink, useAsync } from '../components/ui.jsx';
import PanelLinkBox from '../components/PanelLinkBox.jsx';
import InstallHint from '../components/InstallHint.jsx';
import { typeVars } from '../lib/regTypes.js';
import { usePanelManifest } from '../lib/pwa.js';
import PersonFields, { emptyPerson, validatePerson, personPayload, serverFieldError } from '../components/PersonFields.jsx';
import { Logo, Mark, JohnPhoto, CAMPAIGN } from '../brand/Brand.jsx';
import Celebration from '../brand/Celebration.jsx';

const KICKER = { head: 'Registro de cabeza', leader: 'Registro de líder', person: 'Registro' };
const BUILTIN = { head: 'Cabeza', leader: 'Líder', person: 'Persona' };

/**
 * Lo que ve quien abre el enlace: quién le invita, con su nombre (nunca nombres internos como «Cabeza …»),
 * y a qué le invita. Un líder sin padrino queda con la cabeza de la estructura: la invitación es de ella.
 */
function heroCopy(inv) {
  const { role, inviter, cabeza, head } = inv;
  if (role === 'head') {
    return {
      kicker: 'Te invitamos a ser', title: 'Cabeza del equipo',
      sub: `de ${CAMPAIGN}. Con tu registro nace tu propio equipo: invitarás a tus líderes y a tus personas.`,
    };
  }
  const host = inviter || (role === 'leader' && cabeza ? { name: cabeza.name } : null);
  if (host) {
    return {
      kicker: 'Te invita',
      title: host.name,
      sub: role === 'leader' ? `a ser líder en el equipo de ${CAMPAIGN}.` : `a sumarte al equipo de ${CAMPAIGN}.`,
      team: cabeza && cabeza.name !== host.name ? cabeza.name : null,
    };
  }
  return {
    kicker: 'Te invitamos a ser', title: role === 'leader' ? 'Líder del equipo' : 'Parte del equipo',
    sub: `de ${CAMPAIGN}${head?.display_name ? `, con ${head.display_name}` : ''}.`,
  };
}

function Stage({ chip, children, compact }) {
  return (
    <header className={`pub-stage ${compact ? 'compact' : ''}`}>
      <JohnPhoto variant="hero" className="stage-photo" eager alt="" />
      <div className="stage-logo-wrap"><Logo tone="sky" className="stage-logo" /></div>
      <div className="stage-inner stage-enter">
        {chip}
        {children}
      </div>
    </header>
  );
}

/** Formulario público de registro mediante enlace (pensado para el celular). */
export default function Register() {
  const { token } = useParams();
  const { data: inv, loading, error } = useAsync(() => api.get(`/public/invite/${encodeURIComponent(token)}`), [token]);
  const [f, setF] = useState(emptyPerson);
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  usePanelManifest(done?.panel_token);

  const submit = async (e) => {
    e.preventDefault();
    setSubmitted(true);
    const v = validatePerson(f);
    setFieldErrors(v);
    if (Object.keys(v).length) {
      setErr({ message: 'Revisa los campos marcados en rojo.' });
      const k = Object.keys(v)[0];
      document.getElementById(k === 'localidad' || k === 'barrio' ? `reg-geo-${k}` : k === 'supports' ? 'reg-supports-yes' : `reg-${k}`)?.focus();
      return;
    }
    setErr(null); setBusy(true);
    try {
      setDone(await api.post(`/public/register/${encodeURIComponent(token)}`, { ...personPayload(f), consent, website }));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (ex) { setErr(ex); setFieldErrors((x) => ({ ...x, ...serverFieldError(ex.body?.error) })); } finally { setBusy(false); }
  };

  const type = inv?.type || done?.type;
  const role = done ? (done.is_head ? 'head' : done.is_leader ? 'leader' : 'person') : inv?.role;
  const chip = type && (inv?.valid || done) && (
    <span className="stage-chip"><i aria-hidden="true" />{KICKER[role]}{type.name !== BUILTIN[role] && <><span className="chip-sep" aria-hidden="true" />{type.name}</>}</span>
  );

  // ---- Estados sin formulario
  if (!done && (loading || error || (inv && !inv.valid))) {
    return (
      <div className="pub">
        <Stage>
          {loading ? <div className="stage-skeleton" aria-label="Cargando" /> : (
            <>
              <p className="stage-kicker">{error ? 'Enlace no encontrado' : 'Enlace no disponible'}</p>
              <h1 className="stage-title long">{error ? 'Este enlace no existe' : 'Este enlace ya no sirve'}</h1>
            </>
          )}
        </Stage>
        <div className="pub-right">
          <main className="pub-sheet">
            <div className="sheet-inner">
              {loading ? <div className="loading-block"><span className="spinner" /></div> : (
                <div className="sheet-card state-card warn">
                  <span className="state-icon"><Link2Off size={26} /></span>
                  <h2 className="sheet-title">{error ? 'Revisa el enlace' : 'Pide un enlace nuevo'}</h2>
                  <p className="sheet-lead">{error ? 'Puede que se haya copiado incompleto.' : inv.reason} Pídele un enlace nuevo a la persona que te invitó.</p>
                </div>
              )}
            </div>
          </main>
          <Foot />
        </div>
      </div>
    );
  }

  // ---- Registro completado
  if (done) {
    const team = done.is_head ? `Equipo ${CAMPAIGN}` : done.cabeza ? `Equipo de ${done.cabeza}` : `Equipo ${CAMPAIGN}`;
    const pending = done.status === 'pending';
    const message = pending
      ? 'Tu registro quedó pendiente de aprobación. Te avisaremos cuando quede confirmado.'
      : role === 'head'
        ? 'Tu equipo ya existe. Desde tu panel invitas a tus líderes: cada invitación es personal y sirve para una sola persona.'
        : role === 'leader'
          ? 'Comparte tu link para sumar personas: quedarán contigo y las verás crecer en tu panel.'
          : `Ya eres parte del equipo de ${CAMPAIGN}${done.inviter ? `, gracias a la invitación de ${done.inviter}` : ''}.`;
    return (
      <div className="pub" style={typeVars(type?.color)}>
        <Stage compact chip={<span className="stage-chip"><i aria-hidden="true" />Registro completado</span>}>
          <h1 className="sr-only">Registro completado</h1>
        </Stage>
        <div className="pub-right">
          <main className="pub-sheet">
            <div className="sheet-inner">
              <Celebration role={role} firstName={done.first_name} name={done.full_name} typeName={done.type?.name} team={team}
                code={done.leader_code || done.code} since={done.created_at} pending={pending}>
                <p>{message}</p>
              </Celebration>
              {role === 'head' && done.panel_token && (
                <div className="sheet-card"><PanelLinkBox token={done.panel_token} firstTime head /></div>
              )}
              {done.invite_token && (
                <div className="sheet-card share-card">
                  <h3>{role === 'person' ? 'Invita a más personas' : 'Tu link para sumar personas'}</h3>
                  <p className="sheet-lead" style={{ marginTop: -6 }}>Quienes se registren con él quedarán contigo{done.is_leader ? ' y los verás en tu panel' : ''}.</p>
                  <ShareLink token={done.invite_token} ownerName={done.full_name} asOwner big />
                </div>
              )}
              {role === 'leader' && done.panel_token && (
                <div className="sheet-card"><PanelLinkBox token={done.panel_token} firstTime /></div>
              )}
              {done.panel_token && <InstallHint what="tu panel" storageKey="panel" />}
            </div>
          </main>
          <Foot />
        </div>
      </div>
    );
  }

  // ---- Formulario
  const copy = heroCopy(inv);
  const long = copy.title.length > 16;
  return (
    <div className="pub" style={typeVars(type?.color)}>
      <Stage chip={chip}>
        <p className="stage-kicker">{copy.kicker}</p>
        <h1 className={`stage-title ${long ? 'long' : ''}`}>{copy.title}</h1>
        <p className="stage-sub">{copy.sub}</p>
        {copy.team && <span className="stage-team"><Mark size={14} />Equipo de {copy.team}</span>}
      </Stage>
      <div className="pub-right">
        <main className="pub-sheet">
          <div className="sheet-inner">
            {role !== 'person' && (
              <div className="role-note">
                <Mark size={18} />
                <div>
                  <b>{role === 'head' ? 'Como cabeza tendrás' : 'Como líder tendrás'}</b>
                  <p>{role === 'head'
                    ? 'Invitaciones personales para tus líderes, tu link para sumar personas y un panel con todo tu equipo.'
                    : 'Tu link personal para sumar personas y un panel privado para ver crecer tu red.'}</p>
                </div>
              </div>
            )}
            <form className="sheet-card typed stack" onSubmit={submit} style={{ gap: 16 }} noValidate>
              <div>
                <h2 className="sheet-title">Tus datos</h2>
                <p className="sheet-lead">Toma menos de un minuto.{inv.requires_approval ? ' Tu registro quedará pendiente hasta que lo aprueben.' : ''}</p>
              </div>
              <PersonFields idPrefix="reg" size="lg" slogan value={f} errors={fieldErrors}
                onChange={(v) => {
                  setF(v);
                  if (submitted) { const e2 = validatePerson(v); setFieldErrors(e2); if (!Object.keys(e2).length) setErr(null); }
                }} />
              {/* Campo trampa para bots: invisible para personas */}
              <div aria-hidden="true" style={{ position: 'absolute', left: -5000 }}>
                <label>Sitio web<input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} /></label>
              </div>
              <label className="check">
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} required />
                <span className="text-2">
                  Autorizo el tratamiento de mis datos (nombre, cédula, contacto, dirección y ubicación) con la única finalidad de organizar y contactar a los
                  integrantes del equipo. Sólo los responsables autorizados podrán consultarlos y puedo pedir su corrección o eliminación.
                </span>
              </label>
              {err && <div className="alert alert-error" role="alert"><AlertCircle size={16} />{err.message}</div>}
              <button className="btn btn-primary btn-lg btn-block" disabled={busy || !consent}>
                {busy ? <span className="spinner" /> : role === 'person' ? <UserPlus size={19} /> : <Mark size={17} className="btn-mark" />}
                {role === 'head' ? 'Registrarme como cabeza' : role === 'leader' ? 'Registrarme como líder' : 'Registrarme'}
              </button>
              <p className="secure-note"><Lock size={13} />Tus datos viajan cifrados y no se comparten.</p>
            </form>
            {inv.requires_approval && <p className="secure-note"><Clock size={13} />Un responsable revisará tu registro.</p>}
          </div>
        </main>
        <Foot />
      </div>
    </div>
  );
}

function Foot() {
  return (
    <footer className="pub-foot">
      <Logo tone="navy" />
      <span>Equipo {CAMPAIGN} · Santa Marta</span>
    </footer>
  );
}
