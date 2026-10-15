import { useState } from 'react';
import { Link } from 'react-router-dom';
import { KeyRound, Plus, Power, ShieldCheck, ShieldOff } from 'lucide-react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { fmtDate, relTime } from '../lib/format.js';
import { ConfirmModal, ErrorBox, Loading, Modal, PersonPicker, useAsync, useToast } from '../components/ui.jsx';
import { teamName } from '../lib/teams.js';

const ROLES = { super_admin: 'Administrador general', head_admin: 'Administrador de cabeza', leader: 'Líder', member: 'Persona registrada' };
const ROLE_HELP = {
  super_admin: 'Gestiona todas las cabezas, líderes, personas, enlaces y configuraciones.',
  head_admin: 'Administra únicamente las cabezas que se le asignen.',
  leader: 'Consulta su información y su estructura. Sólo para líderes oficiales.',
  member: 'Ve su ficha, su rama y comparte su invitación personal.',
};

function UserModal({ heads, onClose, onDone }) {
  const a = useAuth();
  const [f, setF] = useState({ username: '', display_name: '', password: '', role: a.isSuper ? 'head_admin' : 'member', head_ids: [] });
  const [person, setPerson] = useState(null);
  const [err, setErr] = useState(null);
  const needsPerson = f.role === 'leader' || f.role === 'member';
  const save = async () => {
    try { await api.post('/users', { ...f, person_id: person?.id }); onDone('Usuario creado'); onClose(); } catch (e) { setErr(e); }
  };
  return (
    <Modal title="Nuevo usuario" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" onClick={save}>Crear</button></>}>
      <div className="stack">
        <div className="field"><label>Rol</label>
          <select className="select" value={f.role} onChange={(e) => { setF({ ...f, role: e.target.value }); setPerson(null); }}>
            {Object.entries(ROLES).filter(([k]) => a.isSuper || k === 'leader' || k === 'member').map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <span className="hint">{ROLE_HELP[f.role]}</span>
        </div>
        {needsPerson && (
          <div className="field"><label>Persona vinculada</label>
            <PersonPicker value={person} onChange={setPerson} filter={(p) => (f.role === 'leader' ? p.is_leader : !p.is_leader) && p.status === 'active'}
              placeholder={f.role === 'leader' ? 'Buscar líder oficial…' : 'Buscar persona…'} />
            {f.role === 'leader' && <span className="hint">Sólo aparecen líderes oficiales: invitar personas no otorga permisos de liderazgo.</span>}
          </div>
        )}
        {f.role === 'head_admin' && (
          <div className="field"><label>Cabezas autorizadas</label>
            <div className="stack" style={{ gap: 6 }}>
              {heads.map((h) => (
                <label key={h.id} className="check"><input type="checkbox" checked={f.head_ids.includes(h.id)}
                  onChange={(e) => setF({ ...f, head_ids: e.target.checked ? [...f.head_ids, h.id] : f.head_ids.filter((x) => x !== h.id) })} />
                  <span className="row"><span className="dot" style={{ background: h.color }} />{teamName(h)}</span></label>
              ))}
            </div>
          </div>
        )}
        <div className="grid g-2">
          <div className="field"><label>Usuario</label><input className="input" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} autoComplete="off" /></div>
          <div className="field"><label>Contraseña (mín. 8)</label><input className="input" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="new-password" /></div>
        </div>
        {!needsPerson && <div className="field"><label>Nombre visible</label><input className="input" value={f.display_name} onChange={(e) => setF({ ...f, display_name: e.target.value })} /></div>}
        <ErrorBox error={err} />
      </div>
    </Modal>
  );
}

function PasswordModal({ user, self, onClose, onDone }) {
  const [current, setCurrent] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState(null);
  const save = async () => {
    try {
      if (self) await api.post('/me/password', { current, password: pw });
      else await api.patch(`/users/${user.id}`, { password: pw });
      onDone('Contraseña actualizada'); onClose();
    } catch (e) { setErr(e); }
  };
  return (
    <Modal title={self ? 'Cambiar mi contraseña' : `Restablecer contraseña de ${user.username}`} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" disabled={pw.length < 8} onClick={save}>Guardar</button></>}>
      <div className="stack">
        {self && <div className="field"><label>Contraseña actual</label><input type="password" className="input" value={current} onChange={(e) => setCurrent(e.target.value)} /></div>}
        <div className="field"><label>Nueva contraseña</label><input type="password" className="input" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" /></div>
        {!self && <span className="small muted">Se cerrarán sus sesiones abiertas.</span>}
        <ErrorBox error={err} />
      </div>
    </Modal>
  );
}

function HeadsModal({ user, heads, onClose, onDone }) {
  const [ids, setIds] = useState(user.head_ids);
  const [err, setErr] = useState(null);
  const save = async () => { try { await api.patch(`/users/${user.id}`, { head_ids: ids }); onDone('Cabezas actualizadas'); onClose(); } catch (e) { setErr(e); } };
  return (
    <Modal title={`Cabezas de ${user.display_name}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" onClick={save}>Guardar</button></>}>
      <div className="stack" style={{ gap: 6 }}>
        {heads.map((h) => (
          <label key={h.id} className="check"><input type="checkbox" checked={ids.includes(h.id)} onChange={(e) => setIds(e.target.checked ? [...ids, h.id] : ids.filter((x) => x !== h.id))} />
            <span className="row"><span className="dot" style={{ background: h.color }} />{teamName(h)}</span></label>
        ))}
        <ErrorBox error={err} />
      </div>
    </Modal>
  );
}

export default function Users() {
  const a = useAuth();
  const toast = useToast();
  const { data, loading, error, reload } = useAsync(() => api.get('/users'), []);
  const heads = useAsync(() => api.get('/heads'), []);
  const [modal, setModal] = useState(null);
  const done = (m) => { toast(m); reload(); };
  const headName = (id) => teamName(heads.data?.find((h) => h.id === id)) || `#${id}`;
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Usuarios y roles</h1><p>Los permisos se verifican en el servidor en cada petición.</p></div>
        <div className="row">
          <button className="btn" onClick={() => setModal({ type: 'self' })}><KeyRound size={15} />Mi contraseña</button>
          <button className="btn btn-primary" onClick={() => setModal({ type: 'new' })}><Plus size={16} />Nuevo usuario</button>
        </div>
      </div>
      <div className="grid g-4 roles-help" style={{ marginBottom: 16 }}>
        {Object.entries(ROLES).map(([k, v]) => (
          <div key={k} className="card card-pad"><div className="row" style={{ gap: 8 }}><ShieldCheck size={16} color="var(--accent)" /><b>{v}</b></div><div className="small muted" style={{ marginTop: 6 }}>{ROLE_HELP[k]}</div></div>
        ))}
      </div>
      <div className="card">
        {loading && !data && <Loading />}
        <ErrorBox error={error} />
        {data && (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Usuario</th><th>Rol</th><th>Alcance</th><th>Último acceso</th><th>Estado</th><th /></tr></thead>
              <tbody>
                {data.map((u) => (
                  <tr key={u.id}>
                    <td><b>{u.display_name}</b><div className="small muted mono">{u.username}</div></td>
                    <td>{ROLES[u.role]}</td>
                    <td className="small">
                      {u.role === 'super_admin' && 'Todas las cabezas'}
                      {u.role === 'head_admin' && (u.head_ids.map(headName).join(', ') || '—')}
                      {(u.role === 'leader' || u.role === 'member') && <Link to={`/personas/${u.person_id}`}>{u.person_name}</Link>}
                    </td>
                    <td className="small">{u.last_login_at ? relTime(u.last_login_at) : <span className="muted">Nunca</span>}<div className="muted">Alta {fmtDate(u.created_at)}</div></td>
                    <td><div className="row-wrap" style={{ gap: 4 }}>
                      {u.status === 'active' ? <span className="badge badge-good">Activo</span> : <span className="badge badge-muted">Desactivado</span>}
                      {u.twofa && <span className="badge badge-outline" title="Entra con contraseña y código del celular"><ShieldCheck size={12} />2 pasos</span>}
                    </div></td>
                    <td>
                      {u.id !== a.user.id && (
                        <div className="row nowrap" style={{ gap: 4 }}>
                          {a.isSuper && u.role === 'head_admin' && <button className="btn btn-sm" onClick={() => setModal({ type: 'heads', user: u })}>Cabezas</button>}
                          <button className="btn btn-sm btn-icon" title="Restablecer contraseña" aria-label="Restablecer contraseña" onClick={() => setModal({ type: 'pw', user: u })}><KeyRound size={14} /></button>
                          {u.twofa && <button className="btn btn-sm btn-icon" title="Quitar la verificación en dos pasos (celular perdido)" aria-label="Quitar la verificación en dos pasos" onClick={() => setModal({ type: 'reset2fa', user: u })}><ShieldOff size={14} /></button>}
                          <button className="btn btn-sm" onClick={async () => { try { await api.patch(`/users/${u.id}`, { status: u.status === 'active' ? 'disabled' : 'active' }); done('Usuario actualizado'); } catch (e) { toast(e.message, 'error'); } }}>
                            <Power size={14} />{u.status === 'active' ? 'Desactivar' : 'Activar'}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {modal?.type === 'new' && <UserModal heads={heads.data || []} onClose={() => setModal(null)} onDone={done} />}
      {modal?.type === 'pw' && <PasswordModal user={modal.user} onClose={() => setModal(null)} onDone={done} />}
      {modal?.type === 'self' && <PasswordModal self onClose={() => setModal(null)} onDone={done} />}
      {modal?.type === 'heads' && <HeadsModal user={modal.user} heads={heads.data || []} onClose={() => setModal(null)} onDone={done} />}
      {modal?.type === 'reset2fa' && <ConfirmModal title={`Quitar la verificación en dos pasos de ${modal.user.display_name}`} danger confirmLabel="Quitar"
        message="Úselo si perdió el celular y sus códigos de recuperación. Se cerrarán sus sesiones; al entrar sólo se le pedirá la contraseña y podrá activarla de nuevo en Mi cuenta."
        onConfirm={async () => { await api.patch(`/users/${modal.user.id}`, { reset_2fa: true }); done('Verificación en dos pasos quitada'); }} onClose={() => setModal(null)} />}
    </div>
  );
}
