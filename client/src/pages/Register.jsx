import { useLayoutEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, ArrowRight, Clock, KeyRound, Lock, Link2Off, UserPlus } from 'lucide-react';
import { api } from '../api.js';
import { ShareLink, useAsync, useToast, inviteMessage, WhatsAppIcon } from '../components/ui.jsx';
import { typeVars } from '../lib/regTypes.js';
import { usePanelManifest } from '../lib/pwa.js';
import { openPanelHere, savePin, markNewPanel, pinFromCedula, readPin } from '../lib/panelSession.js';
import { formatCedula, formatMobile, normalizeCedula, normalizeMobile } from '../lib/validators.js';
import { inviteUrl } from '../lib/format.js';
import { photoSrc } from '../lib/photos.js';
import PersonFields, { emptyPerson, validatePerson, personPayload, serverFieldError } from '../components/PersonFields.jsx';
import { Logo, Mark, JohnPhoto, CAMPAIGN } from '../brand/Brand.jsx';
import Celebration from '../brand/Celebration.jsx';

// De cara a quien se registra no hay «cabezas», «líderes» ni nombres de tipos («CAB», «COV»…): quien recibe una
// invitación personal es una persona de confianza.
const KICKER = { head: 'Persona de confianza', leader: 'Persona de confianza', person: 'Registro' };

// Registro de una persona (enlace general): si recarga la página en esta pestaña sigue viendo su confirmación.
const doneKey = (token) => `reg-done:${token}`;
const readDone = (token) => { try { return JSON.parse(sessionStorage.getItem(doneKey(token)) || 'null'); } catch { return null; } };
const saveDone = (token, d) => { try { if (d) sessionStorage.setItem(doneKey(token), JSON.stringify(d)); else sessionStorage.removeItem(doneKey(token)); } catch { /* sin almacenamiento */ } };

/**
 * Lo que ve quien abre el enlace: quién le invita, con su nombre (nunca nombres internos como «Cabeza …»),
 * y a qué le invita. Las invitaciones personales son para ser persona de confianza: de John (quien arma su propio
 * equipo) o de quien encabeza un equipo. Sin padrino, la invitación es de quien encabeza la estructura.
 */
function heroCopy(inv) {
  const { role, inviter, cabeza, head } = inv;
  if (role === 'head') {
    return {
      kicker: 'Te invita', title: CAMPAIGN,
      sub: 'a ser una de sus personas de confianza. Con tu registro nace tu propio equipo para sumar a tu gente.',
    };
  }
  // Directo con John: quien se registra queda con él, sin nadie en medio.
  if (inv.direct) return { kicker: 'Te invita', title: CAMPAIGN, sub: role === 'leader' ? 'a ser una de sus personas de confianza.' : 'a sumarte a su equipo.' };
  const host = inviter || (role === 'leader' && cabeza ? { name: cabeza.name, photo: cabeza.photo } : null);
  if (host) {
    return {
      kicker: 'Te invita',
      title: host.name,
      photo: host.photo || null,
      sub: role === 'leader' ? `a ser una de sus personas de confianza en el equipo de ${CAMPAIGN}.` : `a sumarte al equipo de ${CAMPAIGN}.`,
      team: cabeza && cabeza.name !== host.name ? cabeza.name : null,
    };
  }
  return {
    kicker: 'Te invitamos a ser', title: role === 'leader' ? 'Persona de confianza' : 'Parte del equipo',
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

function Foot() {
  return (
    <footer className="pub-foot">
      <Logo tone="navy" />
      <span>Equipo {CAMPAIGN} · Santa Marta</span>
    </footer>
  );
}

/** Cada pantalla nueva empieza arriba (en el celular se desplaza la página; en PC, la columna del formulario). */
function useScrollTop(dep) {
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
    document.querySelector('.pub-right')?.scrollTo(0, 0);
  }, [dep]);
}

/**
 * Enlace de un solo uso que ya se usó para registrar a un líder o una cabeza: quien se registró vuelve a su panel
 * escribiendo su cédula y su celular. No hace falta haber guardado el enlace del panel.
 */
function BackToPanel({ token }) {
  const nav = useNavigate();
  const [doc, setDoc] = useState('');
  const [phone, setPhone] = useState('');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const r = await api.post(`/public/recover/${encodeURIComponent(token)}`, { document_id: normalizeCedula(doc), phone: normalizeMobile(phone) });
      savePin(r.panel_token, pinFromCedula(doc));
      markNewPanel(r.panel_token);
      nav(`/panel/${r.panel_token}`, { replace: true });
    } catch (ex) { setErr(ex); } finally { setBusy(false); }
  };
  return (
    <div className="pub">
      <Stage chip={<span className="stage-chip"><i aria-hidden="true" />Ya te registraste</span>}>
        <p className="stage-kicker">Equipo {CAMPAIGN}</p>
        <h1 className="stage-title long">Vuelve a tu panel</h1>
      </Stage>
      <div className="pub-right">
        <main className="pub-sheet">
          <div className="sheet-inner" style={{ maxWidth: 480 }}>
            <form className="sheet-card stack" style={{ gap: 16 }} onSubmit={submit} noValidate>
              <div>
                <h2 className="sheet-title">Entra con tus datos</h2>
                <p className="sheet-lead">Escribe la cédula y el celular con los que te registraste.</p>
              </div>
              <div className="field field-lg"><label htmlFor="bk-doc">Cédula</label>
                <input id="bk-doc" className="input" inputMode="numeric" autoComplete="off" placeholder="1.082.345.678" maxLength={13}
                  value={formatCedula(doc)} onChange={(e) => setDoc(normalizeCedula(e.target.value))} required /></div>
              <div className="field field-lg"><label htmlFor="bk-phone">Celular / WhatsApp</label>
                <input id="bk-phone" className="input" type="tel" inputMode="numeric" autoComplete="tel-national" placeholder="300 555 0123" maxLength={12}
                  value={formatMobile(phone)} onChange={(e) => setPhone(normalizeMobile(e.target.value))}
                  onPaste={(e) => { e.preventDefault(); setPhone(normalizeMobile(e.clipboardData.getData('text'))); }} required /></div>
              {err && <div className="alert alert-error" role="alert"><AlertCircle size={16} />{err.message}</div>}
              <button className="btn btn-primary btn-lg btn-block" disabled={busy || normalizeCedula(doc).length < 4 || normalizeMobile(phone).length < 10}>
                {busy ? <span className="spinner" /> : <KeyRound size={18} />}Entrar a mi panel</button>
              <p className="secure-note"><Lock size={13} />Sólo entra quien conoce la cédula y el celular del registro.</p>
            </form>
            <p className="secure-note">¿No te registraste con este link? Pide uno nuevo a quien te invitó.</p>
          </div>
        </main>
        <Foot />
      </div>
    </div>
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
  const [done, setDone] = useState(() => readDone(token));
  const toast = useToast();
  usePanelManifest(done?.panel_token);
  useScrollTop(done);

  // Cabezas y líderes ponen su foto en la credencial apenas se registran (con su panel, recién abierto en esta pestaña).
  const uploadPhoto = async (image) => {
    const pin = readPin(done.panel_token) || pinFromCedula(f.document_id);
    const r = await api.post(`/public/panel/${encodeURIComponent(done.panel_token)}/photo`, { pin, image });
    setDone((d) => ({ ...d, photo_url: r.photo_url }));
    toast('Foto guardada: ya está en tu credencial y en tu panel.');
    return r.photo_url;
  };

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
      const d = await api.post(`/public/register/${encodeURIComponent(token)}`, { ...personPayload(f), consent, website });
      // Cabezas y líderes: esta página pasa a ser su panel. Si recargan, entran directo (el PIN queda sólo en esta pestaña).
      if (d.panel_token) openPanelHere(d.panel_token, f.document_id);
      else saveDone(token, d);
      setDone(d);
    } catch (ex) { setErr(ex); setFieldErrors((x) => ({ ...x, ...serverFieldError(ex.body?.error) })); } finally { setBusy(false); }
  };
  const registerAnother = () => {
    saveDone(token, null);
    setDone(null); setF(emptyPerson); setConsent(false); setSubmitted(false); setFieldErrors({}); setErr(null);
  };

  const type = inv?.type || done?.type;
  const role = done ? (done.is_head ? 'head' : done.is_leader ? 'leader' : 'person') : inv?.role;
  const chip = type && (inv?.valid || done) && <span className="stage-chip"><i aria-hidden="true" />{KICKER[role]}</span>;

  // ---- Volver al panel con el link de registro ya usado
  if (!done && inv && !inv.valid && inv.recoverable) return <BackToPanel token={token} />;

  // ---- Cargando: sólo la cabecera. La hoja aparece con el contenido final, sin empujar nada (sin saltos al cargar).
  if (!done && loading) {
    return <div className="pub"><Stage><div className="stage-skeleton" aria-label="Cargando" /></Stage></div>;
  }

  // ---- Estados sin formulario
  if (!done && (error || (inv && !inv.valid))) {
    return (
      <div className="pub">
        <Stage>
          <p className="stage-kicker">{error ? 'Enlace no encontrado' : 'Enlace no disponible'}</p>
          <h1 className="stage-title long">{error ? 'Este enlace no existe' : 'Este enlace ya no sirve'}</h1>
        </Stage>
        <div className="pub-right">
          <main className="pub-sheet">
            <div className="sheet-inner">
              <div className="sheet-card state-card warn">
                <span className="state-icon"><Link2Off size={26} /></span>
                <h2 className="sheet-title">{error ? 'Revisa el enlace' : 'Pide un enlace nuevo'}</h2>
                <p className="sheet-lead">{error ? 'Puede que se haya copiado incompleto.' : inv.reason} Pídele un enlace nuevo a la persona que te invitó.</p>
              </div>
            </div>
          </main>
          <Foot />
        </div>
      </div>
    );
  }

  // ---- Registro completado
  if (done) {
    // De quién es persona de confianza: de John (si encabeza su propio equipo o llegó directo con él) o de quien la invitó.
    const host = done.is_head || done.direct ? CAMPAIGN : done.inviter || done.cabeza;
    const team = role === 'person' ? (done.cabeza ? `Equipo de ${done.cabeza}` : `Equipo ${CAMPAIGN}`) : host ? `de ${host}` : `Equipo ${CAMPAIGN}`;
    const pending = done.status === 'pending';
    const message = pending
      ? 'Tu registro quedó pendiente de aprobación. Te avisaremos cuando quede confirmado.'
      : role === 'head'
        ? `${CAMPAIGN} ya cuenta contigo. Desde tu panel invitas a tus propias personas de confianza: ellas suman a su gente y cada persona puede invitar a más.`
        : role === 'leader'
          ? 'En tu panel está tu link: quien se registre con él queda en tu red y también podrá invitar a más.'
          : `Ya eres parte del equipo de ${CAMPAIGN}${done.inviter ? `, gracias a la invitación de ${done.inviter}` : ''}.`;
    const shareWa = done.invite_token
      ? `https://wa.me/?text=${encodeURIComponent(inviteMessage({ url: inviteUrl(done.invite_token), ownerName: done.full_name, asOwner: true }))}`
      : null;
    return (
      <div className="pub" style={typeVars(type?.color)}>
        <Stage compact chip={<span className="stage-chip"><i aria-hidden="true" />Registro completado</span>}>
          <h1 className="sr-only">Registro completado</h1>
        </Stage>
        <div className="pub-right">
          <main className="pub-sheet">
            <div className="sheet-inner">
              <Celebration role={role} firstName={done.first_name} name={done.full_name} team={team}
                code={done.code} since={done.created_at} pending={pending} photo={done.photo_url}
                onPhoto={done.photos_enabled && done.panel_token ? uploadPhoto : undefined} onPhotoError={(e) => toast(e.message, 'error')}>
                <p>{message}</p>
              </Celebration>
              {done.panel_token ? (
                // Cabeza o líder: un solo paso siguiente, su panel. Volver otro día no exige haber guardado nada.
                <div className="sheet-card next-card">
                  <Link className="btn btn-primary btn-lg btn-block" to={`/panel/${done.panel_token}`}>Entrar a mi panel<ArrowRight size={19} /></Link>
                  {shareWa && <a className="btn btn-wa btn-block" href={shareWa} target="_blank" rel="noopener noreferrer"><WhatsAppIcon size={17} />Compartir mi link</a>}
                  <p className="next-note"><KeyRound size={15} />¿Vas a volver otro día? Abre el mismo link con el que te registraste y entra con tu cédula y tu celular.</p>
                </div>
              ) : (
                <>
                  {done.invite_token && (
                    <div className="sheet-card share-card">
                      <h3>Invita a más personas</h3>
                      <p className="sheet-lead" style={{ marginTop: -6 }}>Quienes se registren con tu link quedarán contigo.</p>
                      <ShareLink token={done.invite_token} ownerName={done.full_name} asOwner big />
                    </div>
                  )}
                  <button type="button" className="btn btn-ghost" onClick={registerAnother}><UserPlus size={16} />Registrar a otra persona</button>
                </>
              )}
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
        {/* Con foto, quien invita firma la invitación: su foto al lado de su nombre. Sin foto, sólo el nombre. */}
        {copy.photo ? (
          <div className="stage-byline">
            <span className="stage-host"><img src={photoSrc(copy.photo, 68)} alt="" /></span>
            <div>
              <p className="stage-kicker">{copy.kicker}</p>
              <h1 className={`stage-title ${long ? 'long' : ''}`}>{copy.title}</h1>
            </div>
          </div>
        ) : (
          <>
            <p className="stage-kicker">{copy.kicker}</p>
            <h1 className={`stage-title ${long ? 'long' : ''}`}>{copy.title}</h1>
          </>
        )}
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
                  <b>Como persona de confianza tendrás</b>
                  <p>{role === 'head'
                    ? 'Invitaciones personales para tus propias personas de confianza, tu link para sumar a tu gente y un panel con todo tu equipo.'
                    : 'Tu link personal para sumar a tu gente y un panel privado para ver crecer tu red.'}</p>
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
                {role === 'person' ? 'Registrarme' : 'Aceptar y registrarme'}
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
