import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { AlertCircle, CheckCircle2, Clock, Crown, Lock, UserPlus } from 'lucide-react';
import { api } from '../api.js';
import { Avatar, Loading, ShareLink, useAsync } from '../components/ui.jsx';
import PersonFields, { emptyPerson, validatePerson, personPayload, personName, serverFieldError } from '../components/PersonFields.jsx';

/** Formulario público de registro mediante enlace (pensado para celular). */
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
  const submit = async (e) => {
    e.preventDefault();
    setSubmitted(true);
    const v = validatePerson(f);
    setFieldErrors(v);
    if (Object.keys(v).length) {
      setErr({ message: 'Revise los campos marcados en rojo.' });
      const k = Object.keys(v)[0];
      document.getElementById(k === 'localidad' || k === 'barrio' ? `reg-geo-${k}` : k === 'supports' ? 'reg-supports-yes' : `reg-${k}`)?.focus();
      return;
    }
    setErr(null); setBusy(true);
    try { setDone(await api.post(`/public/register/${encodeURIComponent(token)}`, { ...personPayload(f), consent, website })); }
    catch (ex) { setErr(ex); setFieldErrors((x) => ({ ...x, ...serverFieldError(ex.body?.error) })); } finally { setBusy(false); }
  };

  return (
    <div className="public-wrap">
      <div className="public-card">
        {loading && <Loading />}
        {error && (
          <div className="card card-pad stack" style={{ textAlign: 'center' }}>
            <AlertCircle size={32} color="var(--critical)" style={{ margin: '0 auto' }} />
            <h2>Enlace no válido</h2>
            <p className="text-2" style={{ margin: 0 }}>Este enlace de invitación no existe. Pida un nuevo enlace a la persona que le invitó.</p>
          </div>
        )}
        {inv && !inv.valid && (
          <div className="card card-pad stack" style={{ textAlign: 'center' }}>
            <AlertCircle size={32} color="var(--warning)" style={{ margin: '0 auto' }} />
            <h2>Enlace no disponible</h2>
            <p className="text-2" style={{ margin: 0 }}>{inv.reason} Pida un nuevo enlace a la persona que le invitó.</p>
          </div>
        )}
        {inv?.valid && !done && (
          <>
            <div className="invite-hero">
              <Avatar name={inv.inviter.name} leader={inv.inviter.is_leader} size="lg" />
              <div style={{ minWidth: 0 }}>
                <div className="small muted">Le invita</div>
                <div style={{ fontWeight: 650, fontSize: 17 }} className="row">{inv.inviter.name}{inv.inviter.is_leader && <Crown size={15} color="var(--leader)" />}</div>
                <div className="row small text-2" style={{ marginTop: 2 }}><span className="dot" style={{ background: inv.head.color }} />{inv.head.name}</div>
              </div>
            </div>
            <form className="card card-pad stack" onSubmit={submit} style={{ gap: 14 }}>
              <h2>Complete sus datos</h2>
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
                <span className="small text-2">
                  Autorizo el tratamiento de mis datos (nombre, cédula, contacto, dirección y ubicación) con la única finalidad de organizar y contactar a los integrantes de
                  esta estructura. Sólo los responsables autorizados podrán consultarlos y puedo solicitar su corrección o eliminación.
                </span>
              </label>
              {err && <div className="alert alert-error"><AlertCircle size={16} />{err.message}</div>}
              <button className="btn btn-primary" disabled={busy || !consent}>{busy ? <span className="spinner" /> : <UserPlus size={18} />}Registrarme</button>
              <p className="small muted row" style={{ margin: 0, justifyContent: 'center' }}><Lock size={12} />Sus datos se envían de forma segura.</p>
            </form>
          </>
        )}
        {done && (
          <div className="card card-pad stack" style={{ gap: 14 }}>
            <div style={{ textAlign: 'center' }} className="stack">
              {done.status === 'pending'
                ? <Clock size={40} color="var(--warning)" style={{ margin: '0 auto' }} />
                : <CheckCircle2 size={40} color="var(--good)" style={{ margin: '0 auto' }} />}
              <h2>{done.status === 'pending' ? '¡Registro recibido!' : '¡Registro completado!'}</h2>
              <p className="text-2" style={{ margin: 0 }}>
                {done.status === 'pending'
                  ? `Su registro en ${done.head} quedó pendiente de aprobación. Le avisaremos cuando sea confirmado.`
                  : `Ya forma parte de ${done.head}, invitado por ${done.inviter}. Su identificador es ${done.code}.`}
              </p>
            </div>
            {done.invite_token && (
              <>
                <div className="divider" />
                <h3>Invite a otras personas</h3>
                <p className="small text-2" style={{ margin: 0 }}>Comparta su enlace personal. Quienes se registren con él quedarán vinculados a usted.</p>
                <ShareLink token={done.invite_token} ownerName={personName(f)} headName={done.head} />
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
