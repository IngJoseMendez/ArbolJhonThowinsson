import { Link } from 'react-router-dom';
import { ArrowRight, Focus, GitBranch, Route, UserPlus, X, Crown } from 'lucide-react';
import { api } from '../api.js';
import { fmtDate, fmtNum, METHOD } from '../lib/format.js';
import { Avatar, Loading, RoleBadge, StatusBadge, ShareLink, PersonLink, useAsync, ErrorBox } from './ui.jsx';

/** Ficha resumida de un nodo dentro del explorador del árbol. */
export default function NodePanel({ personId, headName, onClose, onFocus, onHighlight, onRegisterInvitee, canRegister }) {
  const { data, loading, error } = useAsync(() => api.get(`/people/${personId}`), [personId]);
  return (
    <aside className="side-panel" aria-label="Ficha del nodo">
      <div className="card-head" style={{ position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 1 }}>
        <h3>Ficha rápida</h3>
        <button className="btn btn-ghost btn-sm btn-icon" onClick={onClose} aria-label="Cerrar"><X size={16} /></button>
      </div>
      {loading && <Loading />}
      <div style={{ padding: 16 }}><ErrorBox error={error} /></div>
      {data && (() => {
        const p = data.person;
        const link = data.links.find((l) => l.status === 'active');
        return (
          <div className="stack" style={{ padding: '0 18px 18px', gap: 16 }}>
            <div className="row" style={{ gap: 12 }}>
              <Avatar name={p.full_name} leader={p.is_leader} size="lg" />
              <div style={{ minWidth: 0 }}>
                <h2 style={{ fontSize: 18 }}>{p.full_name}</h2>
                <div className="row-wrap" style={{ marginTop: 6 }}>
                  <RoleBadge isLeader={p.is_leader} />
                  <StatusBadge status={p.status} />
                </div>
              </div>
            </div>
            <dl className="kv">
              <dt>Identificador</dt><dd className="mono">{p.code}</dd>
              {p.is_leader && <><dt>Código de líder</dt><dd className="mono">{p.leader_code}</dd></>}
              <dt>Cabeza</dt><dd>{data.head.name}</dd>
              <dt>Invitado por</dt><dd>{data.inviter ? <PersonLink id={data.inviter.id} name={data.inviter.full_name} isLeader={data.inviter.is_leader} /> : <span className="muted">Cuelga de la cabeza</span>}</dd>
              <dt>Líder responsable</dt><dd>{data.leader ? <><PersonLink id={data.leader.id} name={data.leader.full_name} isLeader />{p.leader_mode === 'manual' && <span className="small muted"> (asignado)</span>}</> : <span className="muted">—</span>}</dd>
              <dt>Registro</dt><dd>{fmtDate(p.created_at)} · {METHOD[p.registration_method]}</dd>
              <dt>Ha invitado</dt><dd>{fmtNum(data.invitees.length)} personas directas</dd>
              <dt>En su rama</dt><dd><b>{fmtNum(data.stats.total)}</b> personas{data.stats.leaders ? ` · ${data.stats.leaders} líderes` : ''}</dd>
              {p.is_leader && <><dt>Asignadas</dt><dd>{fmtNum(data.stats.assigned)} personas a su cargo</dd></>}
            </dl>
            {!p.is_leader && data.invitees.length > 0 && (
              <div className="alert alert-info"><GitBranch size={16} /><span>Ha invitado a otras personas, pero <b>no es líder</b>: el liderazgo sólo se otorga por designación.</span></div>
            )}
            <div className="stack" style={{ gap: 8 }}>
              <button className="btn" onClick={() => onHighlight(p.id)}><Route size={15} />Resaltar camino desde la cabeza</button>
              <button className="btn" onClick={() => onFocus(p.id)}><Focus size={15} />Centrarse en esta rama</button>
              {canRegister && p.status === 'active' && <button className="btn" onClick={() => onRegisterInvitee(p)}><UserPlus size={15} />Registrar invitado de {p.full_name.split(' ')[0]}</button>}
              <Link className="btn btn-primary" to={`/personas/${p.id}`}>Abrir ficha completa<ArrowRight size={15} /></Link>
            </div>
            {link && (
              <div className="stack" style={{ gap: 8 }}>
                <h3 className="row">{link.kind === 'leader' ? <><Crown size={14} color="var(--leader)" />Enlace de líder</> : 'Invitación personal'}</h3>
                <ShareLink token={link.token} ownerName={p.full_name} headName={headName} compact />
                <span className="small muted">{fmtNum(link.uses)} registros generados por este enlace</span>
              </div>
            )}
          </div>
        );
      })()}
    </aside>
  );
}
