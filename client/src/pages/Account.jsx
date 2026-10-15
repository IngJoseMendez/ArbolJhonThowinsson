import { useState } from 'react';
import { Check, Copy, Download, KeyRound, LogOut, Moon, ShieldCheck, ShieldOff, Smartphone, Sun } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { fmtDate } from '../lib/format.js';
import { useTheme } from '../lib/theme.js';
import QrCode from '../components/QrCode.jsx';
import { Avatar, ErrorBox, Modal, copyText, useToast } from '../components/ui.jsx';

const groups = (s) => s.replace(/(.{4})/g, '$1 ').trim();

/** Códigos de recuperación: se muestran una sola vez, para copiarlos o descargarlos. */
function RecoveryCodes({ codes, onClose }) {
  const toast = useToast();
  const text = `Códigos de recuperación de Thowinsson (cada uno sirve una vez)\n\n${codes.join('\n')}\n`;
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const link = Object.assign(document.createElement('a'), { href: url, download: 'thowinsson-codigos-de-recuperacion.txt' });
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <div className="stack">
      <div className="alert alert-warn"><ShieldCheck size={16} /><span>Guárdelos en un lugar seguro. Si pierde el celular, son la única forma de entrar sin la app.</span></div>
      <ol className="recovery-grid">{codes.map((c) => <li key={c} className="mono">{c}</li>)}</ol>
      <div className="row-wrap">
        <button type="button" className="btn" onClick={async () => { if (await copyText(codes.join('\n'))) toast('Códigos copiados'); }}><Copy size={15} />Copiar</button>
        <button type="button" className="btn" onClick={download}><Download size={15} />Descargar</button>
        <span className="spacer" />
        <button type="button" className="btn btn-primary" onClick={onClose}><Check size={15} />Ya los guardé</button>
      </div>
    </div>
  );
}

/** Activar: contraseña → agregar la cuenta en la app (QR, enlace o clave) → primer código → códigos de recuperación. */
function EnableModal({ onClose, onDone }) {
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = (fn) => async (e) => {
    e?.preventDefault(); setBusy(true); setErr(null);
    try { await fn(); } catch (ex) { setErr(ex); } finally { setBusy(false); }
  };
  const start = run(async () => setSetup(await api.post('/me/2fa/setup', { password })));
  const confirm = run(async () => { const r = await api.post('/me/2fa/enable', { code }); setCodes(r.recovery_codes); onDone(); });
  if (codes) {
    return <Modal title="Verificación activada" subtitle="Desde ahora, al entrar se le pedirá el código de la app." onClose={onClose}><RecoveryCodes codes={codes} onClose={onClose} /></Modal>;
  }
  return (
    <Modal title="Activar la verificación en dos pasos" subtitle="Además de la contraseña, se le pedirá un código que cambia cada 30 segundos en su celular." onClose={onClose}>
      {!setup ? (
        <form className="stack" onSubmit={start}>
          <div className="field"><label htmlFor="tf-pw">Confirme su contraseña</label>
            <input id="tf-pw" type="password" className="input" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus /></div>
          <ErrorBox error={err} />
          <button className="btn btn-primary" disabled={busy || !password}>{busy && <span className="spinner" />}Continuar</button>
        </form>
      ) : (
        <form className="stack" onSubmit={confirm}>
          <ol className="setup-steps">
            <li>
              <b>Agregue la cuenta en su app de autenticación</b>
              <span>Google Authenticator, Microsoft Authenticator o la que use. Escanee el código o, si está en el mismo celular, ábrala directamente.</span>
              <div className="setup-qr">
                <QrCode text={setup.uri} label="Código QR para la app de autenticación" />
                <div className="stack" style={{ gap: 8, minWidth: 0 }}>
                  <a className="btn btn-primary" href={setup.uri}><Smartphone size={16} />Abrir en la app</a>
                  <div className="key-box">
                    <span className="small muted">O escriba esta clave</span>
                    <code>{groups(setup.secret)}</code>
                    <button type="button" className="btn btn-sm" onClick={async () => { if (await copyText(setup.secret)) toast('Clave copiada'); }}><Copy size={14} />Copiar clave</button>
                  </div>
                </div>
              </div>
            </li>
            <li>
              <b>Escriba el código que muestra la app</b>
              <input className="input code-input" aria-label="Código de 6 dígitos" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric" pattern="[0-9]*" autoComplete="one-time-code" placeholder="000000" required />
            </li>
          </ol>
          <ErrorBox error={err} />
          <button className="btn btn-primary" disabled={busy || code.length !== 6}>{busy && <span className="spinner" />}Activar</button>
        </form>
      )}
    </Modal>
  );
}

/** Desactivar o renovar los códigos: piden un código vigente (de la app o de recuperación). */
function CodeModal({ mode, onClose, onDone }) {
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const off = mode === 'disable';
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      if (off) { await api.post('/me/2fa/disable', { password, code }); onDone('Verificación en dos pasos desactivada'); onClose(); }
      else { const r = await api.post('/me/2fa/recovery-codes', { code }); setCodes(r.recovery_codes); onDone(); }
    } catch (ex) { setErr(ex); } finally { setBusy(false); }
  };
  if (codes) return <Modal title="Códigos nuevos" subtitle="Los anteriores ya no sirven." onClose={onClose}><RecoveryCodes codes={codes} onClose={onClose} /></Modal>;
  return (
    <Modal title={off ? 'Desactivar la verificación en dos pasos' : 'Generar códigos de recuperación nuevos'}
      subtitle={off ? 'Su cuenta quedará protegida sólo con la contraseña.' : 'Los códigos anteriores dejarán de servir.'} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        {off && <div className="field"><label htmlFor="cm-pw">Contraseña</label>
          <input id="cm-pw" type="password" className="input" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus /></div>}
        <div className="field"><label htmlFor="cm-code">Código de la app o de recuperación</label>
          <input id="cm-code" className="input" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" required autoFocus={!off} /></div>
        <ErrorBox error={err} />
        <button className={`btn ${off ? 'btn-danger' : 'btn-primary'}`} disabled={busy || !code || (off && !password)}>{busy && <span className="spinner" />}{off ? 'Desactivar' : 'Generar códigos'}</button>
      </form>
    </Modal>
  );
}

function PasswordModal({ onClose, onDone }) {
  const [current, setCurrent] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState(null);
  const save = async (e) => {
    e.preventDefault();
    try { await api.post('/me/password', { current, password: pw }); onDone('Contraseña actualizada'); onClose(); } catch (ex) { setErr(ex); }
  };
  return (
    <Modal title="Cambiar mi contraseña" subtitle="Se cerrarán sus sesiones en otros dispositivos." onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <div className="field"><label htmlFor="pw-cur">Contraseña actual</label><input id="pw-cur" type="password" className="input" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required autoFocus /></div>
        <div className="field"><label htmlFor="pw-new">Nueva contraseña</label><input id="pw-new" type="password" className="input" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} minLength={8} required />
          <span className="hint">Al menos 8 caracteres.</span></div>
        <ErrorBox error={err} />
        <button className="btn btn-primary" disabled={pw.length < 8 || !current}>Guardar</button>
      </form>
    </Modal>
  );
}

export default function Account() {
  const a = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const theme = useTheme();
  const [modal, setModal] = useState(null);
  const tf = a.me.twofa || { enabled: false };
  const done = async (msg) => { if (msg) toast(msg); await a.refresh(); };
  const logout = async () => { await a.logout(); nav('/login'); };
  return (
    <div className="page page-narrow">
      <div className="account-head">
        <Avatar name={a.user.display_name} size="lg" />
        <div style={{ minWidth: 0 }}>
          <h1 className="ellipsis">{a.user.display_name}</h1>
          <p className="muted" style={{ margin: '2px 0 0' }}>{a.user.display_name !== a.user.role_label && `${a.user.role_label}, `}usuario <span className="mono">{a.user.username}</span></p>
        </div>
      </div>

      <section className={`card card-pad twofa-card ${tf.enabled ? 'on' : ''}`} aria-labelledby="tf-title">
        <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
          <span className="twofa-icon" aria-hidden="true">{tf.enabled ? <ShieldCheck size={22} /> : <ShieldOff size={22} />}</span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <h2 id="tf-title">Verificación en dos pasos</h2>
            {tf.enabled ? (
              <p className="text-2">Activa desde el {fmtDate(tf.since)}. Al entrar se pide la contraseña y el código de su app. Le quedan <b>{tf.recovery_left}</b> códigos de recuperación.</p>
            ) : (
              <p className="text-2">Con la contraseña sola, quien la averigüe puede ver toda la red. Active el código del celular: toma un minuto.</p>
            )}
          </div>
        </div>
        <div className="row-wrap" style={{ marginTop: 12 }}>
          {tf.enabled ? (
            <>
              <button className="btn" onClick={() => setModal('renew')}><KeyRound size={15} />Códigos de recuperación nuevos</button>
              <button className="btn btn-ghost btn-danger" onClick={() => setModal('disable')}>Desactivar</button>
            </>
          ) : <button className="btn btn-primary" onClick={() => setModal('enable')}><ShieldCheck size={16} />Activar verificación</button>}
        </div>
      </section>

      <section className="card list-card" aria-label="Más opciones de la cuenta">
        <button type="button" className="list-row" onClick={() => setModal('password')}><KeyRound size={19} /><span>Cambiar mi contraseña</span></button>
        <button type="button" className="list-row" onClick={theme.toggle}>{theme.dark ? <Sun size={19} /> : <Moon size={19} />}<span>{theme.dark ? 'Usar tema claro' : 'Usar tema oscuro'}</span></button>
        <button type="button" className="list-row danger" onClick={logout}><LogOut size={19} /><span>Cerrar sesión</span></button>
      </section>

      {modal === 'enable' && <EnableModal onClose={() => setModal(null)} onDone={() => done()} />}
      {(modal === 'disable' || modal === 'renew') && <CodeModal mode={modal} onClose={() => setModal(null)} onDone={done} />}
      {modal === 'password' && <PasswordModal onClose={() => setModal(null)} onDone={done} />}
    </div>
  );
}
