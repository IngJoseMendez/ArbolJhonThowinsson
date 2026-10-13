import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle, Network } from 'lucide-react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';

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
    try { await api.post('/auth/login', f); await a.refresh(); nav(loc.state?.from || '/', { replace: true }); }
    catch (ex) { setErr(ex.message); } finally { setBusy(false); }
  };
  return (
    <div className="login-wrap">
      <form className="card" style={{ width: 'min(400px, 100%)', padding: 28 }} onSubmit={submit}>
        <div className="row" style={{ gap: 12, marginBottom: 22 }}>
          <div className="brand-logo" style={{ width: 42, height: 42 }}><Network size={22} /></div>
          <div><h1 style={{ fontSize: 20 }}>Estructuras</h1><div className="muted">Gestión de cabezas, líderes e invitaciones</div></div>
        </div>
        <div className="stack" style={{ gap: 14 }}>
          <div className="field"><label htmlFor="u">Usuario</label>
            <input id="u" className="input" autoComplete="username" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} required autoFocus /></div>
          <div className="field"><label htmlFor="p">Contraseña</label>
            <input id="p" type="password" className="input" autoComplete="current-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required /></div>
          {err && <div className="alert alert-error"><AlertCircle size={16} />{err}</div>}
          <button className="btn btn-primary" style={{ height: 42 }} disabled={busy}>{busy && <span className="spinner" />}Entrar</button>
          <p className="small muted" style={{ margin: 0 }}>¿Quiere registrarse? Use el enlace de invitación que le compartió su líder o la persona que le invitó.</p>
        </div>
      </form>
    </div>
  );
}
