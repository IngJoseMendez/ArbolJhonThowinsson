import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Crown, GitBranch, Search, Users, UserCheck, Link2 } from 'lucide-react';
import { api, qs } from '../api.js';
import { fmtNum, fmtDate } from '../lib/format.js';
import { teamName, useTeams } from '../lib/teams.js';
import { Avatar, ErrorBox, Loading, ShareLink, useAsync, Empty, StatusBadge, RoleBadge } from '../components/ui.jsx';

export default function Leaders() {
  const [headId, setHeadId] = useState('');
  const [term, setTerm] = useState('');
  const heads = useAsync(() => api.get('/heads'), []);
  const teams = useTeams();
  const { data, loading, error } = useAsync(() => api.get(`/leaders${qs({ head_id: headId, q: term.length >= 2 ? term : '' })}`), [headId, term.length >= 2 ? term : '']);
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Líderes</h1><p>Cada líder tiene su link para sumar personas y su panel. Las cabezas aparecen primero en su estructura.</p></div>
      </div>
      <div className="row-wrap" style={{ marginBottom: 16 }}>
        <div className="search-input" style={{ width: 300, maxWidth: '100%' }}>
          <Search size={16} />
          <input className="input" placeholder="Nombre o código" value={term} onChange={(e) => setTerm(e.target.value)} />
        </div>
        <select className="select" style={{ width: 220 }} value={headId} onChange={(e) => setHeadId(e.target.value)} aria-label="Cabeza">
          <option value="">Todas las cabezas</option>
          {heads.data?.map((h) => <option key={h.id} value={h.id}>{teamName(h)}</option>)}
        </select>
        {data && <span className="muted">{fmtNum(data.length)} líderes</span>}
      </div>
      {loading && !data && <Loading />}
      <ErrorBox error={error} />
      {data && data.length === 0 && <div className="card"><Empty icon={Crown} title="No hay líderes que coincidan" /></div>}
      <div className="grid g-auto" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))' }}>
        {data?.map((l) => (
          <div key={l.id} className="card card-pad stack" style={{ gap: 14 }}>
            <div className="row" style={{ gap: 12 }}>
              <Avatar name={l.full_name} leader head={l.is_head} size="lg" />
              <div style={{ minWidth: 0, flex: 1 }}>
                <Link to={`/personas/${l.id}`}><h2 className="ellipsis">{l.full_name}</h2></Link>
                <div className="row" style={{ gap: 6 }}>{l.is_head && <RoleBadge isHead />}<span className="mono muted">{l.leader_code}</span></div>
                <div className="row small" style={{ marginTop: 4 }}><span className="dot" style={{ background: l.head_color }} />{teams.name(l.head_id) || l.head_name}
                  {l.supervisor_name && <span className="muted">· bajo {l.supervisor_name}</span>}</div>
              </div>
              {l.status !== 'active' && <StatusBadge status={l.status} />}
            </div>
            <div className="grid g-3" style={{ gap: 8 }}>
              <div className="card" style={{ padding: 10, boxShadow: 'none' }}><div className="small muted row"><UserCheck size={13} />Asignadas</div><b style={{ fontSize: 18 }} className="tnum">{fmtNum(l.assigned)}</b></div>
              <div className="card" style={{ padding: 10, boxShadow: 'none' }}><div className="small muted row"><Users size={13} />En su rama</div><b style={{ fontSize: 18 }} className="tnum">{fmtNum(l.branch)}</b></div>
              <div className="card" style={{ padding: 10, boxShadow: 'none' }}><div className="small muted row"><Link2 size={13} />Por su enlace</div><b style={{ fontSize: 18 }} className="tnum">{fmtNum(l.link_uses)}</b></div>
            </div>
            {l.link_token ? <ShareLink token={l.link_token} ownerName={l.full_name} compact /> : <div className="alert alert-warn small">Enlace desactivado</div>}
            <div className="row-wrap">
              <Link className="btn btn-sm" to={`/arbol?foco=${l.id}`}><GitBranch size={14} />Ver rama</Link>
              <Link className="btn btn-sm" to={`/personas?leader_id=${l.id}`}><Users size={14} />Personas asignadas</Link>
              <span className="spacer" />
              <span className="small muted">Líder desde {fmtDate(l.leader_since || l.created_at)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
