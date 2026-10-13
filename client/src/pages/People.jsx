import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowDown, ArrowUp, Crown, GitBranch, Search, Users, X } from 'lucide-react';
import { api, qs } from '../api.js';
import { fmtDate, fmtNum, phoneDisplay } from '../lib/format.js';
import { useQueryState } from '../lib/useParams.js';
import { Avatar, ErrorBox, Loading, PersonLink, StatusBadge, useAsync, Empty } from '../components/ui.jsx';

const COLS = [
  { key: 'full_name', label: 'Persona', sort: true },
  { key: 'head', label: 'Cabeza', sort: true },
  { key: 'leader', label: 'Líder responsable', sort: true },
  { key: 'inviter', label: 'Invitado por', sort: true },
  { key: 'descendants', label: 'Rama', sort: true },
  { key: 'created_at', label: 'Registro', sort: true },
  { key: 'status', label: 'Estado', sort: true },
];

export default function People() {
  const nav = useNavigate();
  const [params, setParams] = useQueryState();
  const [term, setTerm] = useState(params.q || '');
  const heads = useAsync(() => api.get('/heads'), []);
  const leaders = useAsync(() => api.get(`/leaders${qs({ head_id: params.head_id })}`), [params.head_id]);
  const query = { sort: 'created_at', dir: 'desc', page: 1, pageSize: 25, ...params };
  const { data, loading, error } = useAsync(() => api.get(`/people${qs(query)}`), [JSON.stringify(query)]);

  useEffect(() => {
    const t = setTimeout(() => { if ((params.q || '') !== term) setParams({ q: term, page: null }, true); }, 300);
    return () => clearTimeout(t);
  }, [term]); // eslint-disable-line react-hooks/exhaustive-deps

  const setFilter = (k) => (e) => setParams({ [k]: e.target.value, page: null });
  const sortBy = (k) => setParams({ sort: k, dir: query.sort === k && query.dir === 'desc' ? 'asc' : 'desc', page: null });
  const pages = data ? Math.max(1, Math.ceil(data.total / query.pageSize)) : 1;
  const filtersOn = ['head_id', 'leader_id', 'inviter_id', 'status', 'type', 'method', 'from', 'to', 'q'].some((k) => params[k]);

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Directorio de personas</h1><p>Búsqueda, filtros y acceso directo a la ficha y a la posición en el árbol.</p></div>
      </div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-pad row-wrap" style={{ gap: 10 }}>
          <div className="search-input" style={{ width: 280, maxWidth: '100%' }}>
            <Search size={16} />
            <input className="input" placeholder="Nombre, identificador o teléfono" value={term} onChange={(e) => setTerm(e.target.value)} />
          </div>
          <select className="select" style={{ width: 170 }} value={params.head_id || ''} onChange={setFilter('head_id')} aria-label="Cabeza">
            <option value="">Todas las cabezas</option>
            {heads.data?.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
          </select>
          <select className="select" style={{ width: 190 }} value={params.leader_id || ''} onChange={setFilter('leader_id')} aria-label="Líder">
            <option value="">Cualquier líder</option>
            {leaders.data?.map((l) => <option key={l.id} value={l.id}>{l.full_name}</option>)}
          </select>
          <select className="select" style={{ width: 140 }} value={params.type || ''} onChange={setFilter('type')} aria-label="Tipo">
            <option value="">Líderes y personas</option><option value="leader">Sólo líderes</option><option value="person">Sólo personas</option>
          </select>
          <select className="select" style={{ width: 140 }} value={params.status || ''} onChange={setFilter('status')} aria-label="Estado">
            <option value="">Estado: vigentes</option><option value="active">Activas</option><option value="pending">Pendientes</option><option value="inactive">Inactivas</option><option value="rejected">Rechazadas</option>
          </select>
          <select className="select" style={{ width: 150 }} value={params.method || ''} onChange={setFilter('method')} aria-label="Método">
            <option value="">Cualquier método</option><option value="invitation">Por enlace</option><option value="manual">Manual</option>
          </select>
          <label className="row small muted">Desde<input type="date" className="input" style={{ width: 150 }} value={params.from || ''} onChange={setFilter('from')} /></label>
          <label className="row small muted">Hasta<input type="date" className="input" style={{ width: 150 }} value={params.to || ''} onChange={setFilter('to')} /></label>
          {filtersOn && <button className="btn btn-ghost btn-sm" onClick={() => { setTerm(''); setParams(Object.fromEntries(Object.keys(params).map((k) => [k, null]))); }}><X size={14} />Limpiar</button>}
        </div>
      </div>
      <div className="card">
        <ErrorBox error={error} />
        {loading && !data && <Loading />}
        {data && data.rows.length === 0 && <Empty icon={Users} title="No hay personas que coincidan" />}
        {data && data.rows.length > 0 && (
          <div className="table-wrap" style={{ opacity: loading ? 0.6 : 1 }}>
            <table className="table">
              <thead>
                <tr>
                  {COLS.map((c) => (
                    <th key={c.key} className={c.sort ? 'sortable' : ''} onClick={() => c.sort && sortBy(c.key)}
                      aria-sort={query.sort === c.key ? (query.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                      <span className="row" style={{ gap: 4 }}>{c.label}{query.sort === c.key && (query.dir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}</span>
                    </th>
                  ))}
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.id} className="clickable" onClick={() => nav(`/personas/${r.id}`)}>
                    <td>
                      <div className="row" style={{ gap: 10 }}>
                        <Avatar name={r.full_name} leader={r.is_leader} />
                        <div style={{ minWidth: 0 }}>
                          <div className="row" style={{ gap: 5 }}><b>{r.full_name}</b>{r.is_leader && <Crown size={13} color="var(--leader)" />}</div>
                          <div className="small muted"><span className="mono">{r.is_leader ? r.leader_code : r.code}</span> · {phoneDisplay(r.phone)}</div>
                        </div>
                      </div>
                    </td>
                    <td><span className="row nowrap"><span className="dot" style={{ background: r.head_color }} />{r.head_name}</span></td>
                    <td><PersonLink id={r.leader_id} name={r.leader_name} isLeader /></td>
                    <td>{r.inviter_id ? <PersonLink id={r.inviter_id} name={r.inviter_name} /> : <span className="muted small">Cabeza</span>}</td>
                    <td className="tnum">{fmtNum(r.descendant_count)}</td>
                    <td className="nowrap small">{fmtDate(r.created_at)}<div className="muted">{r.registration_method === 'manual' ? 'Manual' : 'Enlace'}</div></td>
                    <td><StatusBadge status={r.status} /></td>
                    <td>
                      <button className="btn btn-sm" title="Ver posición en el árbol" onClick={(e) => { e.stopPropagation(); nav(`/arbol?cabeza=${r.head_id}&persona=${r.id}`); }}>
                        <GitBranch size={14} /><span className="hide-sm">Árbol</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && (
          <div className="pager">
            <span className="muted">{fmtNum(data.total)} personas · página {query.page} de {fmtNum(pages)}</span>
            <div className="row">
              <select className="select" style={{ width: 120 }} value={query.pageSize} onChange={(e) => setParams({ pageSize: e.target.value, page: null })} aria-label="Por página">
                {[25, 50, 100].map((n) => <option key={n} value={n}>{n} por página</option>)}
              </select>
              <button className="btn btn-sm" disabled={Number(query.page) <= 1} onClick={() => setParams({ page: Number(query.page) - 1 })}>Anterior</button>
              <button className="btn btn-sm" disabled={Number(query.page) >= pages} onClick={() => setParams({ page: Number(query.page) + 1 })}>Siguiente</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
