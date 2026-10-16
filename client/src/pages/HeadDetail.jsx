import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Crown, Pencil, GitBranch, UserPlus, Network, BarChart3, UserCircle, ChevronLeft } from 'lucide-react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { fmtNum, fmtDate, initials, relTime } from '../lib/format.js';
import { photoSrc } from '../lib/photos.js';
import { DashboardBody } from './Dashboard.jsx';
import { HeadFormModal } from './Heads.jsx';
import { OneTimeLinkCard } from './Links.jsx';
import TreeExplorerView from '../components/TreeExplorerView.jsx';
import RegisterPersonModal from '../components/RegisterPersonModal.jsx';
import { useQueryState } from '../lib/useParams.js';
import { useRegTypes } from '../lib/regTypes.js';
import { Avatar, ErrorBox, Loading, useAsync, Empty, RoleBadge } from '../components/ui.jsx';
import { CAMPAIGN, JohnPhoto, Mark } from '../brand/Brand.jsx';
import { teamName } from '../lib/teams.js';

export default function HeadDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const a = useAuth();
  const [params, setParams] = useQueryState();
  const tab = params.tab || 'resumen';
  const heads = useAsync(() => api.get('/heads'), []);
  const types = useRegTypes();
  const { data, loading, error, reload } = useAsync(() => api.get(`/heads/${id}`), [id]);
  const [editing, setEditing] = useState(false);
  const [registering, setRegistering] = useState(false);

  if (loading && !data) return <Loading />;
  if (error) return <div className="page"><ErrorBox error={error} /></div>;
  const h = data.head;
  const c = data.cabeza;
  const direct = !!h.is_direct; // su equipo directo: John es su cabeza
  const treeParams = { ...params, cabeza: h.id };
  const leaderType = types.list.find((t) => t.builtin && t.role === 'leader');

  return (
    <div className={tab === 'arbol' ? 'page-full' : 'page'}>
      <div style={tab === 'arbol' ? { padding: '16px 16px 0', background: 'var(--surface)' } : undefined}>
        <div className="page-head" style={{ marginBottom: 12 }}>
          {(c || direct) && tab !== 'arbol' ? (
            <Link to="/cabezas" className="back-link"><ChevronLeft size={16} />Cabezas</Link>
          ) : (
            <div className="row" style={{ gap: 14, minWidth: 0 }}>
              <span className={`head-avatar ${c || direct ? '' : 'vacant'} ${c?.photo_url || direct ? 'has-photo' : ''}`} style={{ '--hc': h.color, width: 52, height: 52, fontSize: 19 }} aria-hidden="true">
                {direct ? <JohnPhoto sizes="52px" alt="" /> : c?.photo_url ? <img src={photoSrc(c.photo_url, 52)} alt="" /> : c ? initials(c.full_name) : <Network size={22} />}{(c || direct) && <Mark />}
              </span>
              <div style={{ minWidth: 0 }}>
                <div className="row" style={{ gap: 8 }}>
                  <h1 className="ellipsis">{direct ? CAMPAIGN : c ? c.full_name : h.name}</h1>
                  {h.status === 'archived' && <span className="badge">Archivada</span>}
                </div>
                <p>{direct ? 'Su equipo directo' : `${h.region || 'Sin región'} · creada el ${fmtDate(h.created_at)}`}</p>
              </div>
            </div>
          )}
          <div className="row-wrap">
            {heads.data && heads.data.length > 1 && (
              <select className="select" style={{ width: 210 }} value={h.id} aria-label="Cambiar de cabeza" onChange={(e) => nav(`/cabezas/${e.target.value}?tab=${tab}`)}>
                {heads.data.map((x) => <option key={x.id} value={x.id}>{teamName(x)}</option>)}
              </select>
            )}
            {data.can_manage && <button className="btn" onClick={() => setEditing(true)}><Pencil size={15} />Editar</button>}
            {data.can_manage && h.status === 'active' && <button className="btn btn-primary" onClick={() => setRegistering(true)}><UserPlus size={15} />Registrar</button>}
          </div>
        </div>
        {tab !== 'arbol' && (
          c ? (
            <div className="cabeza-banner">
              <Mark className="watermark" />
              <Avatar name={c.full_name} head size="lg" photo={c.photo_url} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="row-wrap" style={{ gap: 8 }}><RoleBadge isHead /><span className="muted small">de {CAMPAIGN}, desde el {fmtDate(c.created_at)}{h.status === 'archived' ? ' · estructura archivada' : ''}</span></div>
                <h1 className="cabeza-banner-name">{c.full_name}</h1>
                <div className="small muted">
                  {fmtNum(c.descendant_count)} personas en su equipo · {fmtNum(c.child_count)} directas
                  {c.panel_active ? ` · panel ${c.panel_viewed_at ? `abierto ${relTime(c.panel_viewed_at)}` : 'aún sin abrir'}` : ' · sin panel'}
                </div>
              </div>
              <div className="row-wrap">
                <Link className="btn btn-sm" to={`/personas/${c.id}`}><UserCircle size={15} />Ficha</Link>
                <Link className="btn btn-sm btn-sky" to={`/cabezas/${h.id}?tab=arbol&foco=${c.id}`}><GitBranch size={15} />Su árbol</Link>
              </div>
            </div>
          ) : direct ? (
            // Su equipo directo: John es la cabeza de las personas que él invita directamente.
            <div className="cabeza-banner">
              <Mark className="watermark" />
              <div className="avatar head lg has-photo" aria-hidden="true"><JohnPhoto sizes="64px" alt="" /></div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="row-wrap" style={{ gap: 8 }}><RoleBadge isHead /><span className="muted small">de su equipo directo{h.status === 'archived' ? ' · estructura archivada' : ''}</span></div>
                <h1 className="cabeza-banner-name">{CAMPAIGN}</h1>
                <div className="small muted">
                  {fmtNum(data.stats?.totals?.people ?? 0)} personas en su equipo directo: las que él invita y las que ellas suman. Mismas reglas que en
                  cualquier equipo.
                </div>
              </div>
              <div className="row-wrap">
                <Link className="btn btn-sm btn-sky" to={`/cabezas/${h.id}?tab=arbol`}><GitBranch size={15} />Su árbol</Link>
              </div>
            </div>
          ) : (
            <div className="alert alert-info" style={{ marginBottom: 16 }}>
              <Mark size={16} />
              <span>Esta estructura aún no tiene cabeza. {a.isSuper
                ? <>Regístrela con el tipo <b>Cabeza</b> o abra la ficha de uno de sus líderes raíz y elija <b>Designar como cabeza</b>: los demás líderes pasarán a colgar de ella.</>
                : 'Pídale al administrador general que la designe.'}</span>
            </div>
          )
        )}
        <div className="tabs" style={{ marginBottom: tab === 'arbol' ? 0 : 18 }}>
          <button className={`tab ${tab === 'resumen' ? 'active' : ''}`} onClick={() => setParams({ tab: null, foco: null, persona: null })}><BarChart3 size={15} />Resumen</button>
          <button className={`tab ${tab === 'lideres' ? 'active' : ''}`} onClick={() => setParams({ tab: 'lideres' })}><Crown size={15} />Líderes ({data.leaders.filter((l) => !l.is_head).length})</button>
          <button className={`tab ${tab === 'arbol' ? 'active' : ''}`} onClick={() => setParams({ tab: 'arbol' })}><GitBranch size={15} />Árbol completo</button>
        </div>
      </div>

      {tab === 'resumen' && <DashboardBody headId={h.id} days={60} compact />}

      {tab === 'lideres' && (
        <div className="stack" style={{ gap: 16 }}>
          {data.can_manage && h.status === 'active' && leaderType && (
            <div className="grid g-auto">
              <OneTimeLinkCard type={leaderType} heads={[{ ...h, cabeza_name: c?.full_name }]} cabezaName={c?.full_name} />
            </div>
          )}
          <div className="card">
            {data.leaders.filter((l) => !l.is_head).length === 0 && <Empty icon={Crown} title="Todavía no hay líderes">{c ? `Invite líderes para ${c.full_name.split(' ')[0]}: cada uno sumará a su propia gente.` : null}</Empty>}
            <div className="table-wrap">
              {data.leaders.filter((l) => !l.is_head).length > 0 && (
                <table className="table">
                  <thead><tr><th>Líder</th><th>Cuelga de</th><th>Asignadas</th><th>En su rama</th><th>Desde</th><th /></tr></thead>
                  <tbody>
                    {data.leaders.filter((l) => !l.is_head).map((l) => (
                      <tr key={l.id} className="clickable" onClick={() => nav(`/personas/${l.id}`)}>
                        <td><div className="row"><Avatar name={l.full_name} leader photo={l.photo_url} /><div><b>{l.full_name}</b><div className="small muted mono">{l.leader_code}</div></div></div></td>
                        <td>{l.inviter_name || (h.is_direct ? CAMPAIGN : <span className="muted">La estructura</span>)}</td>
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
        </div>
      )}

      {tab === 'arbol' && (
        <TreeExplorerView lockHead heads={[{ ...h, people: data.stats.totals.people, cabeza_name: c?.full_name }]} params={treeParams} setParams={(p) => setParams(p)} />
      )}

      {editing && <HeadFormModal head={h} onClose={() => setEditing(false)} onSaved={() => { reload(); heads.reload(); }} />}
      {registering && <RegisterPersonModal defaultHeadId={h.id} onClose={() => setRegistering(false)} onCreated={(p) => nav(`/personas/${p.id}`)} />}
    </div>
  );
}
