import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Crown, Pencil, GitBranch, UserPlus, Network, BarChart3 } from 'lucide-react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { fmtNum, fmtDate } from '../lib/format.js';
import { DashboardBody } from './Dashboard.jsx';
import { HeadFormModal } from './Heads.jsx';
import TreeExplorerView from '../components/TreeExplorerView.jsx';
import RegisterPersonModal from '../components/RegisterPersonModal.jsx';
import { useQueryState } from '../lib/useParams.js';
import { Avatar, ErrorBox, Loading, useAsync, Empty } from '../components/ui.jsx';

export default function HeadDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const a = useAuth();
  const [params, setParams] = useQueryState();
  const tab = params.tab || 'resumen';
  const heads = useAsync(() => api.get('/heads'), []);
  const { data, loading, error, reload } = useAsync(() => api.get(`/heads/${id}`), [id]);
  const [editing, setEditing] = useState(false);
  const [registering, setRegistering] = useState(false);

  if (loading && !data) return <Loading />;
  if (error) return <div className="page"><ErrorBox error={error} /></div>;
  const h = data.head;
  const treeParams = { ...params, cabeza: h.id };

  return (
    <div className={tab === 'arbol' ? 'page-full' : 'page'}>
      <div className={tab === 'arbol' ? '' : ''} style={tab === 'arbol' ? { padding: '16px 16px 0', background: 'var(--surface)' } : undefined}>
        <div className="page-head" style={{ marginBottom: 12 }}>
          <div className="row" style={{ gap: 14 }}>
            <div className="brand-logo" style={{ background: h.color, width: 44, height: 44 }}><Network size={22} /></div>
            <div>
              <div className="row" style={{ gap: 8 }}>
                <h1>{h.name}</h1>
                {h.status === 'archived' && <span className="badge">Archivada</span>}
              </div>
              <p>{h.region || 'Sin región'} · creada el {fmtDate(h.created_at)}{h.description ? ` · ${h.description}` : ''}</p>
            </div>
          </div>
          <div className="row-wrap">
            {heads.data && heads.data.length > 1 && (
              <select className="select" style={{ width: 200 }} value={h.id} aria-label="Cambiar de cabeza" onChange={(e) => nav(`/cabezas/${e.target.value}?tab=${tab}`)}>
                {heads.data.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            )}
            {data.can_manage && <button className="btn" onClick={() => setEditing(true)}><Pencil size={15} />Editar</button>}
            {data.can_manage && h.status === 'active' && <button className="btn btn-primary" onClick={() => setRegistering(true)}><UserPlus size={15} />Registrar</button>}
          </div>
        </div>
        <div className="tabs" style={{ marginBottom: tab === 'arbol' ? 0 : 16 }}>
          <button className={`tab ${tab === 'resumen' ? 'active' : ''}`} onClick={() => setParams({ tab: null, foco: null, persona: null })}><BarChart3 size={14} /> Resumen</button>
          <button className={`tab ${tab === 'lideres' ? 'active' : ''}`} onClick={() => setParams({ tab: 'lideres' })}><Crown size={14} /> Líderes ({data.leaders.length})</button>
          <button className={`tab ${tab === 'arbol' ? 'active' : ''}`} onClick={() => setParams({ tab: 'arbol' })}><GitBranch size={14} /> Árbol completo</button>
        </div>
      </div>

      {tab === 'resumen' && <DashboardBody headId={h.id} days={60} compact />}

      {tab === 'lideres' && (
        <div className="card">
          {data.leaders.length === 0 && <Empty icon={Crown} title="Esta cabeza aún no tiene líderes" />}
          <div className="table-wrap">
            {data.leaders.length > 0 && (
              <table className="table">
                <thead><tr><th>Líder</th><th>Depende de</th><th>Asignadas</th><th>En su rama</th><th>Desde</th><th /></tr></thead>
                <tbody>
                  {data.leaders.map((l) => (
                    <tr key={l.id} className="clickable" onClick={() => nav(`/personas/${l.id}`)}>
                      <td><div className="row"><Avatar name={l.full_name} leader /><div><b>{l.full_name}</b><div className="small muted mono">{l.leader_code}</div></div></div></td>
                      <td>{l.inviter_name || <span className="muted">Cabeza</span>}</td>
                      <td className="tnum">{fmtNum(l.assigned)}</td>
                      <td className="tnum">{fmtNum(l.branch)}</td>
                      <td className="small muted">{fmtDate(l.created_at)}</td>
                      <td><Link className="btn btn-sm" to={`/cabezas/${h.id}?tab=arbol&foco=${l.id}`} onClick={(e) => e.stopPropagation()}><GitBranch size={14} />Rama</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {tab === 'arbol' && (
        <TreeExplorerView lockHead heads={[{ ...h, people: data.stats.totals.people }]} params={treeParams} setParams={(p) => setParams(p)} />
      )}

      {editing && <HeadFormModal head={h} onClose={() => setEditing(false)} onSaved={() => { reload(); heads.reload(); }} />}
      {registering && <RegisterPersonModal defaultHeadId={h.id} onClose={() => setRegistering(false)} onCreated={(p) => nav(`/personas/${p.id}`)} />}
    </div>
  );
}
