import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Crown, GitBranch, Network, Users, Clock, UserPlus, Link2, Layers } from 'lucide-react';
import { api, qs } from '../api.js';
import { useAuth } from '../auth.jsx';
import { fmtNum, relTime, METHOD } from '../lib/format.js';
import { useTeams } from '../lib/teams.js';
import { GrowthChart, BarList } from '../components/Charts.jsx';
import { Avatar, ErrorBox, Loading, StatTile, StatusBadge, useAsync, Empty, PersonLink, RoleIcon } from '../components/ui.jsx';
import { CAMPAIGN } from '../brand/Brand.jsx';

export function DashboardBody({ headId, days, compact }) {
  const nav = useNavigate();
  const teams = useTeams();
  const { data, loading, error } = useAsync(() => api.get(`/stats/dashboard${qs({ head_id: headId, days })}`), [headId, days]);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const t = data.totals;
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="grid g-4 stats-grid">
        {!compact && <StatTile icon={Network} label="Cabezas" value={fmtNum(t.heads)} sub="Cada una al frente de su estructura" />}
        <StatTile icon={Crown} label="Líderes" value={fmtNum(t.leaders)} sub="Incluye a las cabezas" />
        <StatTile icon={Users} label="Personas registradas" value={fmtNum(t.people)}
          sub={<><span className="delta-up">+{fmtNum(t.last7)}</span> en los últimos 7 días</>} />
        <StatTile icon={Link2} label="Registros por enlace" value={fmtNum(t.via_invitation)} sub={`${fmtNum(t.via_manual)} registros manuales`} />
        {compact && <StatTile icon={Layers} label="Niveles de profundidad" value={fmtNum(t.max_depth + 1)} sub={t.pending ? `${t.pending} pendientes de aprobación` : 'Sin pendientes'} />}
      </div>
      <div className="grid g-3">
        <div className="card span-2">
          <div className="card-head"><div><h2>Crecimiento de las estructuras</h2><p>Personas acumuladas por cabeza · últimos {days} días</p></div></div>
          <div className="card-pad">
            {data.growth.series.length ? <GrowthChart heads={data.growth.heads} series={data.growth.series} /> : <Empty title="Sin datos" />}
          </div>
        </div>
        <div className="card">
          <div className="card-head"><div><h2>{compact ? 'Estado' : 'Personas por cabeza'}</h2><p>{compact ? 'Distribución de registros' : 'Total de integrantes vigentes'}</p></div></div>
          <div className="card-pad">
            {compact ? (
              <BarList items={[
                { key: 'a', label: 'Activas', value: t.active, color: 'var(--good)' },
                { key: 'p', label: 'Pendientes', value: t.pending, color: 'var(--warning)' },
                { key: 'i', label: 'Inactivas', value: t.inactive, color: 'var(--axis)' },
              ]} />
            ) : data.perHead.length ? (
              <BarList onClick={(it) => nav(`/cabezas/${it.key}`)} items={data.perHead.map((h) => ({
                key: h.id, label: h.cabeza_name || h.name, value: h.people, color: h.color, dot: h.color,
                tip: [['Líderes', fmtNum(h.leaders)], ['Pendientes', fmtNum(h.pending)]],
              }))} />
            ) : <Empty title="Aún no hay cabezas" />}
          </div>
        </div>
      </div>
      <div className="grid g-2">
        <div className="card">
          <div className="card-head"><div><h2>Personas por líder</h2><p>Personas asignadas como responsable · rama de invitación</p></div><Link to="/lideres" className="btn btn-sm">Ver líderes</Link></div>
          <div className="card-pad">
            {data.perLeader.length ? (
              <BarList onClick={(it) => nav(`/personas/${it.key}`)} items={data.perLeader.map((l) => ({
                key: l.id, label: l.full_name, value: l.assigned, dot: l.head_color,
                tip: [['Equipo', teams.name(l.head_id) || l.head_name], ['Código', l.leader_code], ['Personas en su rama', fmtNum(l.branch)]],
              }))} valueLabel="Asignadas" />
            ) : <Empty icon={Crown} title="Sin líderes todavía" />}
          </div>
        </div>
        <div className="card">
          <div className="card-head"><div><h2>Registros recientes</h2><p>Quién se registró y quién le invitó</p></div><Link to="/personas" className="btn btn-sm">Directorio</Link></div>
          <div>
            {data.recent.length === 0 && <Empty icon={UserPlus} title="Sin registros" />}
            {data.recent.map((r) => (
              <div key={r.id} className="row" style={{ padding: '10px 18px', borderBottom: '1px solid var(--border)', gap: 12, cursor: 'pointer' }}
                onClick={() => nav(`/personas/${r.id}`)}>
                <Avatar name={r.full_name} leader={r.is_leader} head={r.is_head} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="row" style={{ gap: 6 }}><b className="ellipsis">{r.full_name}</b><RoleIcon isHead={r.is_head} isLeader={r.is_leader} /></div>
                  <div className="small muted ellipsis">
                    {r.inviter_name ? <>Invitado por <PersonLink id={r.inviter_id} name={r.inviter_name} /></> : r.is_head ? `Cabeza, invitada por ${CAMPAIGN}` : 'Líder raíz'} · {METHOD[r.registration_method]}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="row small" style={{ justifyContent: 'flex-end' }}><span className="dot" style={{ background: r.head_color }} />{teams.name(r.head_id) || r.head_name}</div>
                  <div className="small muted">{relTime(r.created_at)}</div>
                </div>
                {r.status !== 'active' && <StatusBadge status={r.status} />}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const a = useAuth();
  const [days, setDays] = useState(90);
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Así crece el equipo</h1>
          <p>{a.user.role === 'leader' ? 'Cifras de su estructura' : 'Cifras en tiempo real a partir de los registros'}</p>
        </div>
        <div className="row-wrap">
          <div className="seg" role="radiogroup" aria-label="Periodo">
            {[30, 90, 180, 365].map((d) => <button key={d} className={days === d ? 'active' : ''} onClick={() => setDays(d)}>{d} d</button>)}
          </div>
          <Link className="btn" to="/arbol"><GitBranch size={16} />Abrir árbol</Link>
          {a.isAdmin && <Link className="btn" to="/enlaces?tab=pendientes"><Clock size={16} />Pendientes</Link>}
        </div>
      </div>
      <DashboardBody days={days} />
    </div>
  );
}
