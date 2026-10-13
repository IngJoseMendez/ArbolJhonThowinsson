import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Ban, Check, CheckCircle2, Clock, Copy, Crown, Link2, Power, Search, Settings2, XCircle } from 'lucide-react';
import { api, qs } from '../api.js';
import { useAuth } from '../auth.jsx';
import { fmtDate, fmtNum, inviteUrl, relTime, phoneDisplay } from '../lib/format.js';
import { useQueryState } from '../lib/useParams.js';
import { ConfirmModal, ErrorBox, Loading, Modal, PersonLink, copyText, useAsync, useToast, Empty } from '../components/ui.jsx';

function LimitsModal({ link, onClose, onDone }) {
  const [maxUses, setMaxUses] = useState(link.max_uses ?? '');
  const [expires, setExpires] = useState(link.expires_at ? link.expires_at.slice(0, 10) : '');
  const [err, setErr] = useState(null);
  const save = async () => {
    try { await api.patch(`/links/${link.id}`, { max_uses: maxUses === '' ? null : Number(maxUses), expires_at: expires ? `${expires}T23:59:59` : null }); onDone('Límites actualizados'); onClose(); }
    catch (e) { setErr(e); }
  };
  return (
    <Modal title="Límites del enlace" subtitle={link.token} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" onClick={save}>Guardar</button></>}>
      <div className="stack">
        <div className="field"><label>Máximo de registros</label><input className="input" type="number" min="1" value={maxUses} onChange={(e) => setMaxUses(e.target.value)} placeholder="Sin límite" />
          <span className="hint">Actualmente {link.uses} registros.</span></div>
        <div className="field"><label>Caduca el</label><input className="input" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} /></div>
        <ErrorBox error={err} />
      </div>
    </Modal>
  );
}

function LinksTab() {
  const toast = useToast();
  const [f, setF] = useState({ q: '', kind: '', status: '', head_id: '' });
  const [page, setPage] = useState(1);
  const heads = useAsync(() => api.get('/heads'), []);
  const { data, loading, error, reload } = useAsync(() => api.get(`/links${qs({ ...f, q: f.q.length >= 2 ? f.q : '', page, pageSize: 50 })}`), [JSON.stringify(f), page]);
  const [modal, setModal] = useState(null);
  const done = (m) => { toast(m); reload(); };
  const copy = async (t) => { if (await copyText(inviteUrl(t))) toast('Enlace copiado'); };
  const pages = data ? Math.max(1, Math.ceil(data.total / 50)) : 1;
  return (
    <>
      <div className="row-wrap" style={{ marginBottom: 12 }}>
        <div className="search-input" style={{ width: 260 }}><Search size={16} />
          <input className="input" placeholder="Propietario o token" value={f.q} onChange={(e) => { setF({ ...f, q: e.target.value }); setPage(1); }} /></div>
        <select className="select" style={{ width: 170 }} value={f.head_id} onChange={(e) => { setF({ ...f, head_id: e.target.value }); setPage(1); }} aria-label="Cabeza">
          <option value="">Todas las cabezas</option>{heads.data?.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
        </select>
        <select className="select" style={{ width: 170 }} value={f.kind} onChange={(e) => { setF({ ...f, kind: e.target.value }); setPage(1); }} aria-label="Tipo">
          <option value="">Líderes y personas</option><option value="leader">Enlaces de líder</option><option value="person">Invitaciones personales</option>
        </select>
        <select className="select" style={{ width: 140 }} value={f.status} onChange={(e) => { setF({ ...f, status: e.target.value }); setPage(1); }} aria-label="Estado">
          <option value="">Todos</option><option value="active">Activos</option><option value="disabled">Desactivados</option>
        </select>
      </div>
      <div className="card">
        <ErrorBox error={error} />
        {loading && !data && <Loading />}
        {data && data.rows.length === 0 && <Empty icon={Link2} title="No hay enlaces" />}
        {data && data.rows.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Enlace</th><th>Generado por</th><th>Cabeza</th><th>Registros</th><th>Último uso</th><th>Estado</th><th /></tr></thead>
              <tbody>
                {data.rows.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <div className="row" style={{ gap: 6 }}>{l.kind === 'leader' ? <Crown size={14} color="var(--leader)" /> : <Link2 size={14} className="muted" />}<span className="mono">{l.token}</span></div>
                      <div className="small muted">{l.kind === 'leader' ? 'Enlace de líder' : 'Invitación personal'} · creado {fmtDate(l.created_at)}
                        {l.max_uses ? ` · máx. ${l.max_uses}` : ''}{l.expires_at ? ` · caduca ${fmtDate(l.expires_at)}` : ''}</div>
                    </td>
                    <td><PersonLink id={l.owner_person_id} name={l.owner_name} isLeader={l.owner_is_leader} /></td>
                    <td><span className="row nowrap"><span className="dot" style={{ background: l.head_color }} />{l.head_name}</span></td>
                    <td className="tnum"><b>{fmtNum(l.uses)}</b>{l.pending > 0 && <span className="badge badge-warning" style={{ marginLeft: 6 }}>{l.pending} pend.</span>}</td>
                    <td className="small">{l.last_used ? relTime(l.last_used) : <span className="muted">Nunca</span>}</td>
                    <td>{l.status === 'active'
                      ? <span className="badge badge-good"><Check size={12} />Activo</span>
                      : <span className="badge badge-muted" title={l.disabled_reason || ''}><Ban size={12} />Desactivado</span>}
                      {l.status !== 'active' && l.disabled_reason && <div className="small muted ellipsis" style={{ maxWidth: 180 }}>{l.disabled_reason.startsWith('auto:') ? 'Automático' : l.disabled_reason}</div>}
                    </td>
                    <td>
                      <div className="row nowrap" style={{ gap: 4 }}>
                        {l.status === 'active' && <button className="btn btn-sm btn-icon" title="Copiar" aria-label="Copiar" onClick={() => copy(l.token)}><Copy size={14} /></button>}
                        {l.status === 'active' && <a className="btn btn-sm btn-wa" href={`https://wa.me/?text=${encodeURIComponent(`Te invito a registrarte en ${l.head_name}: ${inviteUrl(l.token)}`)}`} target="_blank" rel="noopener noreferrer">WhatsApp</a>}
                        {l.can_manage && l.status === 'active' && <button className="btn btn-sm btn-icon" title="Límites" aria-label="Límites" onClick={() => setModal({ type: 'limits', link: l })}><Settings2 size={14} /></button>}
                        {l.can_manage && l.status === 'active' && <button className="btn btn-sm btn-danger" onClick={() => setModal({ type: 'disable', link: l })}><Power size={14} />Desactivar</button>}
                        {l.can_manage && l.status !== 'active' && l.owner_status === 'active' && <button className="btn btn-sm" onClick={() => setModal({ type: 'enable', link: l })}>Reactivar</button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && (
          <div className="pager">
            <span className="muted">{fmtNum(data.total)} enlaces</span>
            <div className="row">
              <button className="btn btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</button>
              <button className="btn btn-sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Siguiente</button>
            </div>
          </div>
        )}
      </div>
      {modal?.type === 'disable' && <ConfirmModal title="Desactivar enlace" danger reason reasonRequired confirmLabel="Desactivar"
        message={<>El enlace <span className="mono">{modal.link.token}</span> dejará de admitir registros. Las personas ya registradas no se ven afectadas.</>}
        onConfirm={async (reason) => { await api.post(`/links/${modal.link.id}/disable`, { reason }); done('Enlace desactivado'); }} onClose={() => setModal(null)} />}
      {modal?.type === 'enable' && <ConfirmModal title="Reactivar enlace" confirmLabel="Reactivar"
        onConfirm={async () => { await api.post(`/links/${modal.link.id}/enable`); done('Enlace reactivado'); }} onClose={() => setModal(null)} />}
      {modal?.type === 'limits' && <LimitsModal link={modal.link} onClose={() => setModal(null)} onDone={done} />}
    </>
  );
}

function PendingTab() {
  const toast = useToast();
  const { data, loading, error, reload } = useAsync(() => api.get('/pending'), []);
  const [modal, setModal] = useState(null);
  if (loading && !data) return <Loading />;
  return (
    <div className="card">
      <ErrorBox error={error} />
      {data?.length === 0 && <Empty icon={CheckCircle2} title="No hay registros pendientes">Active «Aprobar registros por enlace» en una cabeza para revisar los registros antes de incorporarlos.</Empty>}
      {data?.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Persona</th><th>Cabeza</th><th>Invitado por</th><th>Enlace usado</th><th>Recibido</th><th /></tr></thead>
            <tbody>
              {data.map((p) => (
                <tr key={p.id}>
                  <td><Link to={`/personas/${p.id}`}><b>{p.full_name}</b></Link><div className="small muted">{phoneDisplay(p.phone)}{p.city ? ` · ${p.city}` : ''}</div></td>
                  <td><span className="row nowrap"><span className="dot" style={{ background: p.head_color }} />{p.head_name}</span></td>
                  <td><PersonLink id={p.inviter_id} name={p.inviter_name} />{p.leader_name && <div className="small muted">Líder: {p.leader_name}</div>}</td>
                  <td className="mono small">{p.link_token}</td>
                  <td className="small">{relTime(p.created_at)}</td>
                  <td>
                    <div className="row nowrap">
                      <button className="btn btn-sm btn-primary" onClick={() => setModal({ p, status: 'active' })}><CheckCircle2 size={14} />Aprobar</button>
                      <button className="btn btn-sm btn-danger" onClick={() => setModal({ p, status: 'rejected' })}><XCircle size={14} />Rechazar</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {modal && <ConfirmModal title={modal.status === 'active' ? `Aprobar a ${modal.p.full_name}` : `Rechazar a ${modal.p.full_name}`}
        danger={modal.status === 'rejected'} reason reasonRequired={modal.status === 'rejected'} confirmLabel={modal.status === 'active' ? 'Aprobar' : 'Rechazar'}
        onConfirm={async (reason) => { await api.post(`/people/${modal.p.id}/status`, { status: modal.status, reason }); toast('Registro actualizado'); reload(); }}
        onClose={() => setModal(null)} />}
    </div>
  );
}

export default function Links() {
  const a = useAuth();
  const [params, setParams] = useQueryState();
  const tab = params.tab === 'pendientes' && a.isAdmin ? 'pendientes' : 'enlaces';
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Enlaces e invitaciones</h1><p>Cada enlace identifica a quien invita. La cabeza y el invitador se determinan en el servidor a partir del enlace, nunca desde la URL.</p></div>
      </div>
      <div className="tabs">
        <button className={`tab ${tab === 'enlaces' ? 'active' : ''}`} onClick={() => setParams({ tab: null })}><Link2 size={14} /> Enlaces</button>
        {a.isAdmin && <button className={`tab ${tab === 'pendientes' ? 'active' : ''}`} onClick={() => setParams({ tab: 'pendientes' })}><Clock size={14} /> Pendientes de aprobación</button>}
      </div>
      {tab === 'enlaces' ? <LinksTab /> : <PendingTab />}
    </div>
  );
}
