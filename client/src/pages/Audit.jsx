import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ShieldAlert, ShieldCheck } from 'lucide-react';
import { api, qs } from '../api.js';
import { fmtDateTime, fmtNum } from '../lib/format.js';
import { ErrorBox, Loading, useAsync, useToast } from '../components/ui.jsx';

const ACTIONS = {
  'person.create_manual': 'Registro manual', 'person.register_invite': 'Registro por enlace', 'person.promote_leader': 'Designación de líder',
  'person.demote_leader': 'Retiro de liderazgo', 'person.set_leader': 'Cambio de líder responsable', 'person.move': 'Movimiento de rama',
  'person.move_head': 'Cambio de cabeza', 'person.update': 'Edición de datos', 'person.approved': 'Aprobación', 'person.rejected': 'Rechazo',
  'person.deactivated': 'Desactivación', 'person.reactivated': 'Reactivación', 'link.disable': 'Enlace desactivado', 'link.enable': 'Enlace reactivado',
  'link.update': 'Límites de enlace', 'link.regenerate': 'Enlace regenerado', 'head.create': 'Cabeza creada', 'head.update': 'Cabeza editada',
  'user.create': 'Usuario creado', 'user.update': 'Usuario editado', 'user.password_change': 'Cambio de contraseña', 'auth.login': 'Inicio de sesión',
  'auth.login_failed': 'Inicio de sesión fallido', 'admin.recount': 'Reparación de contadores',
};

export default function Audit() {
  const toast = useToast();
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);
  const { data, loading, error } = useAsync(() => api.get(`/audit${qs({ action, page, pageSize: 50 })}`), [action, page]);
  const [integrity, setIntegrity] = useState(null);
  const check = async () => {
    try { setIntegrity(await api.get('/admin/integrity')); } catch (e) { toast(e.message, 'error'); }
  };
  const pages = data ? Math.max(1, Math.ceil(data.total / 50)) : 1;
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Auditoría</h1><p>Registro de solo lectura de las acciones sensibles realizadas en la plataforma.</p></div>
        <div className="row-wrap">
          <button className="btn" onClick={check}><ShieldCheck size={16} />Verificar integridad de la estructura</button>
          {integrity?.issues.some((i) => i.type === 'counters') && (
            <button className="btn btn-primary" onClick={async () => {
              try { const r = await api.post('/admin/recount'); toast(`${r.fixed} contadores reparados`); check(); } catch (e) { toast(e.message, 'error'); }
            }}>Reparar contadores</button>
          )}
        </div>
      </div>
      {integrity && (
        <div className={`alert ${integrity.ok ? 'alert-good' : 'alert-error'}`} style={{ marginBottom: 16 }}>
          {integrity.ok ? <ShieldCheck size={16} /> : <ShieldAlert size={16} />}
          <div>
            {integrity.ok ? 'Sin inconsistencias: rutas del árbol, pertenencia a cabezas, líderes, raíces, contadores y duplicados verificados.' : `${integrity.total_issues} inconsistencias detectadas.`}
            {integrity.issues.slice(0, 20).map((i, k) => <div key={k} className="small"><Link to={`/personas/${i.person_id}`}>#{i.person_id}</Link> · {i.message}</div>)}
          </div>
        </div>
      )}
      <div className="row-wrap" style={{ marginBottom: 12 }}>
        <select className="select" style={{ width: 260 }} value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} aria-label="Acción">
          <option value="">Todas las acciones</option>
          <option value="person.">Personas</option><option value="link.">Enlaces</option><option value="head.">Cabezas</option>
          <option value="user.">Usuarios</option><option value="auth.">Accesos</option>
        </select>
      </div>
      <div className="card">
        <ErrorBox error={error} />
        {loading && !data && <Loading />}
        {data && (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Objeto</th><th>Detalles</th><th>IP</th></tr></thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.id}>
                    <td className="small nowrap">{fmtDateTime(r.created_at)}</td>
                    <td>{r.user_name || <span className="muted">Público</span>}</td>
                    <td>{ACTIONS[r.action] || r.action}</td>
                    <td className="small">{r.entity === 'person' && r.entity_id ? <Link to={`/personas/${r.entity_id}`}>Persona #{r.entity_id}</Link> : `${r.entity}${r.entity_id ? ` #${r.entity_id}` : ''}`}</td>
                    <td className="small mono" style={{ maxWidth: 360, overflowWrap: 'anywhere' }}>{Object.keys(r.details).length ? JSON.stringify(r.details) : ''}</td>
                    <td className="small muted">{r.ip}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && (
          <div className="pager">
            <span className="muted">{fmtNum(data.total)} eventos</span>
            <div className="row">
              <button className="btn btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</button>
              <button className="btn btn-sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Siguiente</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
