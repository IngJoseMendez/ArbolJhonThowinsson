import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { AlertCircle, CheckCircle2, Clock, Crown, Lock, Network, UserPlus } from 'lucide-react';
import { api } from '../api.js';
import { Avatar, Loading, ShareLink, useAsync } from '../components/ui.jsx';

/** Formulario público de registro mediante enlace (pensado para celular). */
export default function Register() {
  const { token } = useParams();
  const { data: inv, loading, error } = useAsync(() => api.get(`/public/invite/${encodeURIComponent(token)}`), [token]);
  const [f, setF] = useState({ full_name: '', phone: '', city: '', email: '', consent: false, website: '' });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const submit = async (e) => {
    e.preventDefault(); setErr(null); setBusy(true);
    try { setDone(await api.post(`/public/register/${encodeURIComponent(token)}`, f)); }
    catch (ex) { setErr(ex); } finally { setBusy(false); }
  };

  return (
    <div className="public-wrap">
      <div className="public-card">
        <div className="row" style={{ gap: 10, marginBottom: 18, justifyContent: 'center' }}>
          <div className="brand-logo"><Network size={18} /></div><b style={{ fontSize: 16 }}>Registro de la estructura</b>
        </div>
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
              <div className="field">
                <label htmlFor="n">Nombre completo</label>
                <input id="n" className="input" value={f.full_name} onChange={set('full_name')} required minLength={3} maxLength={120} autoComplete="name" />
              </div>
              <div className="field">
                <label htmlFor="t">Celular / WhatsApp</label>
                <input id="t" className={`input ${err?.field === 'phone' ? 'invalid' : ''}`} value={f.phone} onChange={set('phone')} required inputMode="tel" autoComplete="tel" placeholder="300 123 4567" />
              </div>
              <div className="field">
                <label htmlFor="c">Municipio o barrio <span className="muted">(opcional)</span></label>
                <input id="c" className="input" value={f.city} onChange={set('city')} maxLength={80} autoComplete="address-level2" />
              </div>
              <div className="field">
                <label htmlFor="e">Correo <span className="muted">(opcional)</span></label>
                <input id="e" type="email" className="input" value={f.email} onChange={set('email')} autoComplete="email" />
              </div>
              {/* Campo trampa para bots: invisible para personas */}
              <div aria-hidden="true" style={{ position: 'absolute', left: -5000 }}>
                <label>Sitio web<input tabIndex={-1} autoComplete="off" value={f.website} onChange={set('website')} /></label>
              </div>
              <label className="check">
                <input type="checkbox" checked={f.consent} onChange={set('consent')} required />
                <span className="small text-2">
                  Autorizo el tratamiento de mis datos (nombre y contacto) con la única finalidad de organizar y contactar a los integrantes de
                  esta estructura. Sólo los responsables autorizados podrán consultarlos y puedo solicitar su corrección o eliminación.
                </span>
              </label>
              {err && <div className="alert alert-error"><AlertCircle size={16} />{err.message}</div>}
              <button className="btn btn-primary" disabled={busy || !f.consent}>{busy ? <span className="spinner" /> : <UserPlus size={18} />}Registrarme</button>
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
                <ShareLink token={done.invite_token} ownerName={f.full_name} headName={done.head} />
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
