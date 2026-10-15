import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle, LogIn } from 'lucide-react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Logo, JohnPhoto, CAMPAIGN, SLOGAN } from '../brand/Brand.jsx';
import { markAdminDevice } from '../lib/pwa.js';

export default function Login() {
  const a = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [f, setF] = useState({ username: '', password: '' });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  if (a.me) return <Navigate to={loc.state?.from || '/'} replace />;
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { await api.post('/auth/login', f); markAdminDevice(); await a.refresh(); nav(loc.state?.from || '/', { replace: true }); }
    catch (ex) { setErr(ex.message); } finally { setBusy(false); }
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
          </div>
        </main>
        <footer className="pub-foot"><Logo tone="navy" /><span>Equipo {CAMPAIGN} · Santa Marta</span></footer>
      </div>
    </div>
  );
}
