import { useEffect, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle, ChevronLeft, LogIn, ShieldCheck } from 'lucide-react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useToast } from '../components/ui.jsx';
import { Logo, JohnPhoto, CAMPAIGN, SLOGAN } from '../brand/Brand.jsx';
import { markAdminDevice } from '../lib/pwa.js';

// Código de recuperación: 16 caracteres que se escriben en grupos de cuatro (XXXX-XXXX-XXXX-XXXX).
const fmtRecovery = (v) => v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16).replace(/(.{4})(?=.)/g, '$1-');

/** Segundo paso: el código de 6 dígitos de la app de autenticación (o uno de recuperación). */
function CodeStep({ challenge, onDone, onRestart }) {
  const [recovery, setRecovery] = useState(false);
  const [code, setCode] = useState('');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const input = useRef(null);
  useEffect(() => { input.current?.focus(); }, [recovery]);
  const send = async (value) => {
    if (busy) return;
    setBusy(true); setErr(null);
    try { onDone(await api.post('/auth/login/2fa', { challenge, code: value })); }
    catch (ex) {
      if (ex.code === 'CHALLENGE_EXPIRED') onRestart(ex.message);
      else { setErr(ex.message); setCode(''); input.current?.focus(); }
    } finally { setBusy(false); }
  };
  const onChange = (e) => {
    const v = recovery ? fmtRecovery(e.target.value) : e.target.value.replace(/\D/g, '').slice(0, 6);
    setCode(v);
    // Con el sexto dígito se envía solo (también cuando el celular lo pega desde la app).
    if (!recovery && v.length === 6) send(v);
  };
  return (
    <form className="sheet-card login-form" onSubmit={(e) => { e.preventDefault(); send(code); }}>
      <div>
        <span className="state-icon-sm" aria-hidden="true"><ShieldCheck size={22} /></span>
        <h2 className="sheet-title">Verificación en dos pasos</h2>
        <p className="sheet-lead">{recovery
          ? 'Escriba uno de sus códigos de recuperación. Cada uno sirve una sola vez.'
          : 'Abra su app de autenticación y escriba el código de 6 dígitos de Thowinsson.'}</p>
      </div>
      <div className="field">
        <label htmlFor="code">{recovery ? 'Código de recuperación' : 'Código de la app'}</label>
        {recovery
          ? <input id="code" ref={input} className="input code-input is-recovery" value={code} onChange={onChange} autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder="XXXX-XXXX-XXXX-XXXX" required />
          : <input id="code" ref={input} className="input code-input" value={code} onChange={onChange} inputMode="numeric" pattern="[0-9]*" autoComplete="one-time-code" placeholder="000000" required />}
      </div>
      {err && <div className="alert alert-error" role="alert"><AlertCircle size={16} />{err}</div>}
      <button className="btn btn-primary btn-lg btn-block" disabled={busy || (recovery ? code.replace(/[^A-Z0-9]/g, '').length !== 16 : code.length !== 6)}>
        {busy ? <span className="spinner" /> : <LogIn size={18} />}Entrar
      </button>
      <div className="row-wrap" style={{ justifyContent: 'space-between' }}>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onRestart()}><ChevronLeft size={15} />Volver</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setRecovery(!recovery); setCode(''); setErr(null); }}>
          {recovery ? 'Usar el código de la app' : '¿Sin su celular? Use un código de recuperación'}
        </button>
      </div>
    </form>
  );
}

export default function Login() {
  const a = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const toast = useToast();
  const [f, setF] = useState({ username: '', password: '' });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [challenge, setChallenge] = useState(null);
  if (a.me) return <Navigate to={loc.state?.from || '/'} replace />;
  const enter = async (r) => {
    markAdminDevice();
    if (r?.recovery_left !== undefined) toast(r.recovery_left > 2 ? `Le quedan ${r.recovery_left} códigos de recuperación` : `Le quedan ${r.recovery_left} códigos de recuperación: genere nuevos en Mi cuenta`, r.recovery_left > 2 ? 'ok' : 'error');
    await a.refresh();
    nav(loc.state?.from || '/', { replace: true });
  };
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      const r = await api.post('/auth/login', f);
      if (r.twofa) { setChallenge(r.challenge); setF({ ...f, password: '' }); } else await enter(r);
    } catch (ex) { setErr(ex.message); } finally { setBusy(false); }
  };
  return (
    <div className="pub">
      <header className="pub-stage">
        <JohnPhoto variant="hero" className="stage-photo" eager alt="" />
        <div className="stage-logo-wrap"><Logo tone="sky" className="stage-logo" /></div>
        <div className="stage-inner stage-enter">
          <p className="stage-kicker">Equipo {CAMPAIGN}</p>
          <h1 className="stage-title long">{SLOGAN}</h1>
        </div>
      </header>
      <div className="pub-right">
        <main className="pub-sheet center">
          <div className="sheet-inner" style={{ maxWidth: 440 }}>
            {challenge ? (
              <CodeStep challenge={challenge} onDone={enter} onRestart={(msg) => { setChallenge(null); setErr(msg || null); }} />
            ) : (
              <form className="sheet-card login-form" onSubmit={submit}>
                <div>
                  <h2 className="sheet-title">Entrar</h2>
                  <p className="sheet-lead">Coordinación del equipo: cabezas, líderes y personas.</p>
                </div>
                <div className="field"><label htmlFor="u">Usuario</label>
                  <input id="u" className="input" autoComplete="username" autoCapitalize="none" spellCheck={false} value={f.username}
                    onChange={(e) => setF({ ...f, username: e.target.value })} required autoFocus /></div>
                <div className="field"><label htmlFor="p">Contraseña</label>
                  <input id="p" type="password" className="input" autoComplete="current-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required /></div>
                {err && <div className="alert alert-error" role="alert"><AlertCircle size={16} />{err}</div>}
                <button className="btn btn-primary btn-lg btn-block" disabled={busy}>{busy ? <span className="spinner" /> : <LogIn size={18} />}Entrar</button>
                <p className="small muted" style={{ margin: 0 }}>¿Quieres registrarte? Usa el link que te compartió tu líder o la persona que te invitó.</p>
              </form>
            )}
          </div>
        </main>
        <footer className="pub-foot"><Logo tone="navy" /><span>Equipo {CAMPAIGN} · Santa Marta</span></footer>
      </div>
    </div>
  );
}
