import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Crown, GitBranch, Network, UserCheck, Send, Pencil, MoveRight, Power, CheckCircle2, XCircle, KeyRound, Users, Layers,
  ClipboardList, RefreshCw, ChevronRight, UserPlus, Info, Link2, ShieldCheck, ChevronsDown, MapPin, Eye,
} from 'lucide-react';
import { api } from '../api.js';
import { fmtDate, fmtDateTime, fmtNum, phoneDisplay, relTime } from '../lib/format.js';
import { BarList } from '../components/Charts.jsx';
import RegisterPersonModal from '../components/RegisterPersonModal.jsx';
import PanelLinkBox from '../components/PanelLinkBox.jsx';
import { OneTimeLinkCard } from './Links.jsx';
import {
  HISTORY, SUPPORTS, HistoryDetail, EditModal, LocationModal, MoveModal, LeaderModal, AccountModal,
} from '../components/person/PersonModals.jsx';
import { Mark } from '../brand/Brand.jsx';
import { useRegTypes } from '../lib/regTypes.js';
import { formatCedula } from '../lib/validators.js';
import {
  Avatar, ConfirmModal, ErrorBox, Loading, Modal, PersonLink, RoleBadge, ShareLink, StatusBadge, useAsync, useToast, Empty, HeadPill, LocationText,
} from '../components/ui.jsx';

function Rel({ icon: Icon, color, label, children, sub }) {
  return (
    <div className="rel">
      <div className="rel-icon" style={{ background: `color-mix(in srgb, ${color} 14%, transparent)`, color }}><Icon size={17} /></div>
      <div style={{ minWidth: 0 }}>
        <div className="rel-label">{label}</div>
        <div style={{ fontWeight: 600 }} className="ellipsis">{children}</div>
        {sub && <div className="small muted">{sub}</div>}
      </div>
    </div>
  );
}

export default function Person() {
  const { id } = useParams();
  const toast = useToast();
  const { data, loading, error, reload } = useAsync(() => api.get(`/people/${id}`), [id]);
  const [modal, setModal] = useState(null);
  const [panelToken, setPanelToken] = useState(null);
  const types = useRegTypes();
  const leaderType = types.list.find((t) => t.builtin && t.role === 'leader');
  const done = (msg) => { toast(msg); reload(); };

  if (loading && !data) return <Loading />;
  if (error) return <div className="page"><ErrorBox error={error} /></div>;
  const { person: p, head, leader, inviter, invitees, stats, chain, history, links, permissions: perm, names } = data;
  const activeLink = links.find((l) => l.status === 'active');
  const act = (url, body, msg) => async (reason) => { await api.post(url, { ...body, reason }); done(msg); };

  return (
    <div className="page">
      {/* Cabecera */}
      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div className="row-wrap" style={{ gap: 16, alignItems: 'flex-start' }}>
          <Avatar name={p.full_name} leader={p.is_leader} head={p.is_head} size="lg" />
          <div style={{ flex: 1, minWidth: 220 }}>
            <h1>{p.full_name}</h1>
            <div className="row-wrap" style={{ marginTop: 8 }}>
              <RoleBadge isLeader={p.is_leader} isHead={p.is_head} code={p.is_head ? null : p.leader_code} />
              {types.byId[p.reg_type_id] && !(types.byId[p.reg_type_id].builtin && types.byId[p.reg_type_id].role !== 'person' && (p.is_head || p.is_leader))
                && <span className="type-chip" style={{ '--chip': types.byId[p.reg_type_id].color }} title="Tipo de registro">{types.byId[p.reg_type_id].name}</span>}
              {!p.is_leader && invitees.length > 0 && <span className="badge" title="Ha invitado a otras personas sin ser líder oficial"><Send size={12} />Invita a otras personas · no es líder</span>}
              <StatusBadge status={p.status} />
              {!p.is_head && <HeadPill name={head.cabeza ? `Equipo de ${head.cabeza.full_name}` : head.name} color={head.color} />}
              <span className="badge badge-outline mono">{p.code}</span>
            </div>
          </div>
          <div className="row-wrap">
            <Link className="btn" to={`/arbol?cabeza=${p.head_id}&persona=${p.id}`}><GitBranch size={15} />Ver en el árbol</Link>
            {stats.total > 0 && <Link className="btn" to={`/arbol?cabeza=${p.head_id}&foco=${p.id}&expandir=todo`} title="Abre la rama con todos sus niveles expandidos"><ChevronsDown size={15} />Ver rama completa</Link>}
            {perm.manage && p.status === 'active' && <button className="btn" onClick={() => setModal('register')}><UserPlus size={15} />Registrar invitado</button>}
          </div>
        </div>
        {perm.manage && (
          <>
            <div className="divider" />
            <div className="row-wrap">
              {p.status === 'pending' && <>
                <button className="btn btn-primary btn-sm" onClick={() => setModal('approve')}><CheckCircle2 size={14} />Aprobar registro</button>
                <button className="btn btn-danger btn-sm" onClick={() => setModal('reject')}><XCircle size={14} />Rechazar</button>
              </>}
              <button className="btn btn-sm" onClick={() => setModal('edit')}><Pencil size={14} />Editar datos</button>
              {p.status === 'active' && !p.is_leader && <button className="btn btn-sm" onClick={() => setModal('promote')}><Crown size={14} />Designar como líder</button>}
              {perm.super && p.is_leader && !p.is_head && !inviter && !head.cabeza && p.status === 'active' && <button className="btn btn-sm" onClick={() => setModal('make-head')}><Mark size={13} />Designar como cabeza</button>}
              {perm.super && p.is_head && <button className="btn btn-sm" onClick={() => setModal('unmake-head')}><Mark size={13} />Quitar como cabeza</button>}
              {p.is_leader && !p.is_head && <button className="btn btn-sm" onClick={() => setModal('demote')}><Crown size={14} />Retirar liderazgo</button>}
              {!p.is_head && <button className="btn btn-sm" onClick={() => setModal('leader')}><UserCheck size={14} />Cambiar líder responsable</button>}
              {p.status !== 'rejected' && !p.is_head && <button className="btn btn-sm" onClick={() => setModal('move')}><MoveRight size={14} />Mover rama</button>}
              {p.status === 'active' && <button className="btn btn-sm btn-danger" onClick={() => setModal('deactivate')}><Power size={14} />Desactivar</button>}
              {p.status === 'inactive' && <button className="btn btn-sm" onClick={() => setModal('reactivate')}><Power size={14} />Reactivar</button>}
              {!data.account && p.status === 'active' && <button className="btn btn-sm" onClick={() => setModal('account')}><KeyRound size={14} />Crear acceso</button>}
              {data.account && <span className="badge badge-outline"><ShieldCheck size={12} />Acceso: {data.account.username}{data.account.status !== 'active' ? ' (desactivado)' : ''}</span>}
            </div>
          </>
        )}
      </div>

      {/* Relaciones (no se confunden) */}
      <div className="grid g-4" style={{ marginBottom: 16 }}>
        <Rel icon={Network} color={head.color} label="Estructura" sub={p.is_head ? 'La encabeza' : head.cabeza ? 'Su cabeza' : 'Sin cabeza asignada'}>
          {p.is_head ? `Equipo de ${p.full_name}` : !head.cabeza ? head.name : <PersonLink id={head.cabeza.id} name={head.cabeza.full_name} isHead />}
        </Rel>
        <Rel icon={Crown} color="var(--leader)" label="Responsabilidad · Líder"
          sub={leader ? (p.leader_mode === 'manual' ? 'Asignado manualmente' : 'Líder más cercano en su cadena') : 'Sin líder por encima'}>
          {leader ? <PersonLink id={leader.id} name={leader.full_name} isLeader isHead={leader.is_head} /> : '—'}
        </Rel>
        <Rel icon={Send} color="var(--series-1)" label="Invitación directa · Invitado por"
          sub={data.via_link ? `Mediante el enlace ${data.via_link.token}` : p.registration_method === 'manual' ? 'Asignado en registro manual' : ''}>
          {inviter ? <PersonLink id={inviter.id} name={inviter.full_name} isLeader={inviter.is_leader} isHead={inviter.is_head} /> : p.is_head ? 'Nadie: es la cabeza' : 'Cuelga de la estructura'}
        </Rel>
        <Rel icon={ClipboardList} color="var(--text-2)" label="Registro"
          sub={p.registration_method === 'manual' ? `Por ${data.registered_by?.display_name || '—'}` : 'Autorregistro con enlace'}>
          {fmtDate(p.created_at)} · {p.registration_method === 'manual' ? 'Manual' : 'Enlace'}
        </Rel>
      </div>

      <div className="grid g-3">
        <div className="stack span-2" style={{ gap: 16 }}>
          {/* Posición */}
          <div className="card">
            <div className="card-head"><div><h2>Posición en el árbol</h2><p>Camino de invitaciones desde la cabeza · nivel {p.depth + 1}</p></div></div>
            <div className="card-pad">
              <div className="breadcrumb">
                <span className="crumb" style={{ background: `color-mix(in srgb, ${head.color} 16%, transparent)` }}><Network size={12} />{head.cabeza ? `Equipo de ${head.cabeza.full_name}` : head.name}</span>
                {chain.map((c) => (
                  <span key={c.id} className="row" style={{ gap: 4 }}>
                    <ChevronRight size={14} className="sep" />
                    {c.id === p.id
                      ? <span className="crumb current">{c.is_head ? <Mark size={11} /> : c.is_leader && <Crown size={12} />}{c.full_name}</span>
                      : <Link to={`/personas/${c.id}`} className={`crumb ${c.is_head ? 'head' : c.is_leader ? 'leader' : ''}`}>{c.is_head ? <Mark size={11} /> : c.is_leader && <Crown size={12} />}{c.full_name}</Link>}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Estadísticas de rama */}
          <div className="card">
            <div className="card-head"><div><h2>Su rama</h2><p>Personas que entraron a través de su cadena de invitaciones</p></div>
              <div className="row-wrap">
                <Link className="btn btn-sm" to={`/arbol?cabeza=${p.head_id}&foco=${p.id}`}><GitBranch size={14} />Ver rama</Link>
                {stats.total > 0 && <Link className="btn btn-sm" to={`/arbol?cabeza=${p.head_id}&foco=${p.id}&expandir=todo`}><ChevronsDown size={14} />Expandir todo</Link>}
              </div></div>
            <div className="card-pad stack">
              <div className="grid g-4" style={{ gap: 10 }}>
                <div><div className="small muted row"><Users size={13} />En su rama</div><div style={{ fontSize: 22, fontWeight: 650 }}>{fmtNum(stats.total)}</div></div>
                <div><div className="small muted row"><Send size={13} />Invitó directamente</div><div style={{ fontSize: 22, fontWeight: 650 }}>{fmtNum(invitees.length)}</div></div>
                <div><div className="small muted row"><Layers size={13} />Niveles debajo</div><div style={{ fontSize: 22, fontWeight: 650 }}>{fmtNum(stats.max_depth)}</div></div>
                <div><div className="small muted row"><Crown size={13} />{p.is_leader ? 'Asignadas a su cargo' : 'Líderes en su rama'}</div><div style={{ fontSize: 22, fontWeight: 650 }}>{fmtNum(p.is_leader ? stats.assigned : stats.leaders)}</div></div>
              </div>
              {stats.byLevel.length > 0 && (
                <>
                  <h3>Personas por nivel</h3>
                  <BarList items={stats.byLevel.map((l) => ({ key: l.level, label: `Nivel ${l.level}${l.level === 1 ? ' (invitados directos)' : ''}`, value: l.n }))} />
                </>
              )}
            </div>
          </div>

          {/* Invitados directos */}
          <div className="card">
            <div className="card-head"><div><h2>A quién ha invitado</h2><p>Invitaciones directas · {fmtNum(invitees.length)}</p></div></div>
            {invitees.length === 0 ? <Empty icon={Send} title="Todavía no ha invitado a nadie" /> : (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Persona</th><th>Líder responsable</th><th>Su rama</th><th>Registro</th><th>Estado</th></tr></thead>
                  <tbody>
                    {invitees.map((i) => (
                      <tr key={i.id}>
                        <td><PersonLink id={i.id} name={i.full_name} isLeader={i.is_leader} /></td>
                        <td className="small">{i.leader_name || '—'}</td>
                        <td className="tnum">{fmtNum(i.descendant_count)}</td>
                        <td className="small">{fmtDate(i.created_at)} · {i.registration_method === 'manual' ? 'manual' : 'enlace'}</td>
                        <td><StatusBadge status={i.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div className="stack" style={{ gap: 16 }}>
          {/* Enlace */}
          <div className="card card-pad stack">
            <h2 className="row">{p.is_head ? <><Mark size={15} className="role-icon" />Su link para personas</> : p.is_leader ? <><Crown size={16} color="var(--leader)" />Enlace de líder</> : <><Link2 size={16} />Invitación personal</>}</h2>
            {activeLink ? (
              <>
                <ShareLink token={activeLink.token} ownerName={p.full_name} />
                <div className="small muted">{fmtNum(activeLink.uses)} registros con este enlace{activeLink.pending ? ` · ${activeLink.pending} pendientes` : ''}{activeLink.last_used ? ` · último ${relTime(activeLink.last_used)}` : ''}</div>
                <div className="small muted">Quien se registre con él quedará con {p.full_name.split(' ')[0]} como invitador. La estructura y el invitador se validan en el servidor.</div>
              </>
            ) : (
              <div className="small muted">{p.status !== 'active' ? 'Disponible cuando la persona esté activa.' : !p.is_leader && !head.person_invites_enabled ? 'Las invitaciones personales están deshabilitadas en esta cabeza.' : 'No tiene enlace activo.'}</div>
            )}
            {(perm.manage || perm.self) && p.status === 'active' && (p.is_leader || head.person_invites_enabled) && (
              <button className="btn btn-sm" onClick={() => setModal('regen')}><RefreshCw size={14} />{activeLink ? 'Regenerar enlace' : 'Generar enlace'}</button>
            )}
            {p.is_leader === false && <div className="alert alert-info small"><Info size={14} />Invitar no convierte a nadie en líder.</div>}
          </div>

          {p.is_head && perm.manage && p.status === 'active' && leaderType && (
            <OneTimeLinkCard type={leaderType} heads={[{ ...head, status: 'active', can_manage: true, cabeza_name: p.full_name }]} cabezaName={p.full_name} />
          )}

          {p.is_leader && perm.manage && (
            <div className="card card-pad stack">
              <h2 className="row"><Eye size={16} />Panel de gestión</h2>
              <p className="small text-2" style={{ margin: 0 }}>Enlace privado de solo lectura para que {p.full_name.split(' ')[0]} vea {p.is_head ? 'todo su equipo e invite a sus líderes' : 'su red'} sin usuario ni contraseña. Se abre con los últimos 4 dígitos de su cédula.</p>
              {p.panel_active
                ? <div className="small">Activo desde {fmtDate(p.panel_created_at)} · {p.panel_viewed_at ? `abierto ${relTime(p.panel_viewed_at)}` : 'aún no lo ha abierto'}</div>
                : <div className="small muted">Sin enlace de panel.</div>}
              <div className="row-wrap">
                <button className="btn btn-sm" onClick={() => setModal('panel')}><KeyRound size={14} />{p.panel_active ? 'Generar uno nuevo' : 'Generar enlace del panel'}</button>
                {p.panel_active && <button className="btn btn-sm btn-ghost" onClick={() => setModal('panel-revoke')}>Desactivar</button>}
              </div>
            </div>
          )}

          {/* Datos */}
          <div className="card card-pad stack">
            <h2>Datos de contacto</h2>
            <dl className="kv">
              <dt>Celular</dt><dd>{phoneDisplay(p.phone)}</dd>
              {perm.contact && <><dt>Cédula</dt><dd>{p.document_id ? formatCedula(p.document_id) : <span className="muted">Sin registrar</span>}</dd>
                <dt>Dirección</dt><dd>{p.address || <span className="muted">Sin registrar</span>}</dd>
                {p.email && <><dt>Correo</dt><dd>{p.email}</dd></>}</>}
              <dt>¿Es voto seguro?</dt><dd>{p.secure_vote ? <span className={`badge ${p.secure_vote === 'yes' ? 'badge-good' : 'badge-outline'}`}>{SUPPORTS[p.secure_vote]}</span> : <span className="muted">Sin valorar</span>}</dd>
              <dt>¿Contamos contigo?</dt><dd>{p.supports ? <span className={`badge ${p.supports === 'yes' ? 'badge-good' : 'badge-outline'}`}>{SUPPORTS[p.supports]}</span> : <span className="muted">Sin respuesta</span>}</dd>
              <dt>Ubicación</dt><dd><LocationText loc={data.location} />
                {perm.manage && <div><button className="btn btn-sm btn-ghost" style={{ paddingLeft: 0 }} onClick={() => setModal('location')}><MapPin size={13} />{data.location?.status === 'pending' ? 'Verificar / corregir' : 'Corregir ubicación'}</button></div>}</dd>
              {p.city && <><dt>Municipio (anterior)</dt><dd>{p.city}</dd></>}
              {perm.manage && p.notes && <><dt>Observaciones</dt><dd>{p.notes}</dd></>}
              <dt>Consentimiento</dt><dd>{p.consent_at ? fmtDateTime(p.consent_at) : <span className="muted">No registrado</span>}</dd>
              <dt>Actualizado</dt><dd>{relTime(p.updated_at)}</dd>
            </dl>
            {!perm.contact && <span className="small muted">Algunos datos se ocultan según sus permisos.</span>}
          </div>

          {/* Historial */}
          <div className="card card-pad stack">
            <h2>Historial</h2>
            {history.length === 0 ? <span className="muted">Sin cambios registrados.</span> : (
              <ul className="timeline">
                {history.map((h) => (
                  <li key={h.id}>
                    <div style={{ fontWeight: 600 }}>{HISTORY[h.change_type] || h.change_type}</div>
                    <div className="small text-2"><HistoryDetail h={h} names={names} /></div>
                    {h.reason && <div className="small">Motivo: <i>{h.reason}</i></div>}
                    <div className="small muted">{fmtDateTime(h.created_at)}{h.changed_by_name ? ` · ${h.changed_by_name}` : ''}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {perm.manage && links.length > 1 && (
            <div className="card card-pad stack">
              <h2>Todos sus enlaces</h2>
              {links.map((l) => (
                <div key={l.id} className="row small" style={{ justifyContent: 'space-between' }}>
                  <span className="mono ellipsis">{l.token}</span>
                  <span className="row">{fmtNum(l.uses)} usos <span className={`badge ${l.status === 'active' ? 'badge-good' : 'badge-muted'}`}>{l.status === 'active' ? 'Activo' : 'Inactivo'}</span></span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {modal === 'edit' && <EditModal p={p} types={types.list} onClose={() => setModal(null)} onDone={done} />}
      {modal === 'panel' && <ConfirmModal title={p.panel_active ? 'Generar un nuevo enlace del panel' : 'Generar enlace del panel'} confirmLabel="Generar"
        message={p.panel_active ? 'El enlace actual dejará de funcionar. Entregue el nuevo sólo a la persona por un canal privado.' : 'Se creará un enlace privado de solo lectura. Entréguelo sólo a la persona por un canal privado.'}
        onConfirm={async () => { const r = await api.post(`/people/${p.id}/panel`); setPanelToken(r.token); reload(); }} onClose={() => setModal(null)} />}
      {modal === 'panel-revoke' && <ConfirmModal title="Desactivar panel" danger confirmLabel="Desactivar"
        message="El enlace del panel dejará de funcionar. Puede generar uno nuevo cuando quiera."
        onConfirm={async () => { await api.post(`/people/${p.id}/panel/revoke`); done('Panel desactivado'); }} onClose={() => setModal(null)} />}
      {panelToken && (
        <Modal title="Enlace del panel" onClose={() => setPanelToken(null)} footer={<button className="btn btn-primary" onClick={() => setPanelToken(null)}>Listo</button>}>
          <PanelLinkBox token={panelToken} head={p.is_head} />
        </Modal>
      )}
      {modal === 'make-head' && <ConfirmModal title={`Designar a ${p.full_name} como cabeza`} reason confirmLabel="Designar cabeza"
        message={<>Será la cabeza de <b>{head.name}</b>: invitará líderes y personas desde su panel. Los demás líderes que cuelgan directamente de la estructura pasarán a colgar de {p.full_name.split(' ')[0]}, con sus ramas.</>}
        onConfirm={async (reason) => { const r = await api.post(`/people/${p.id}/head-role`, { is_head: true, reason }); done(r.adopted ? `Ahora es la cabeza: ${r.adopted} líderes cuelgan de ella` : 'Ahora es la cabeza de la estructura'); }}
        onClose={() => setModal(null)} />}
      {modal === 'unmake-head' && <ConfirmModal title="Quitar como cabeza" reason danger confirmLabel="Quitar como cabeza"
        message={<>{p.full_name} seguirá siendo líder raíz y conservará su rama, pero ya no invitará líderes desde su panel. La estructura quedará sin cabeza hasta designar otra.</>}
        onConfirm={async (reason) => { await api.post(`/people/${p.id}/head-role`, { is_head: false, reason }); done('Ya no es la cabeza de la estructura'); }}
        onClose={() => setModal(null)} />}
      {modal === 'location' && <LocationModal p={p} location={data.location} onClose={() => setModal(null)} onDone={done} />}
      {modal === 'move' && <MoveModal p={p} head={head} onClose={() => setModal(null)} onDone={done} />}
      {modal === 'leader' && <LeaderModal p={p} onClose={() => setModal(null)} onDone={done} />}
      {modal === 'account' && <AccountModal p={p} onClose={() => setModal(null)} onDone={done} />}
      {modal === 'register' && <RegisterPersonModal defaultHeadId={p.head_id} onClose={() => setModal(null)} onCreated={() => done('Invitado registrado')}
        defaultInviter={{ id: p.id, full_name: p.full_name, head_id: p.head_id, is_leader: p.is_leader, code: p.code, leader_code: p.leader_code, leader_name: leader?.full_name, status: p.status }} />}
      {modal === 'promote' && <ConfirmModal title="Designar como líder oficial" reason confirmLabel="Designar líder"
        message={<>Se asignará un código <b>LID-…</b> y un enlace de líder. Las personas de su rama con líder automático pasarán a tenerle como responsable. El historial de invitaciones no cambia.</>}
        onConfirm={act(`/people/${p.id}/promote`, {}, 'Designado como líder')} onClose={() => setModal(null)} />}
      {modal === 'demote' && <ConfirmModal title="Retirar liderazgo" reason reasonRequired danger confirmLabel="Retirar liderazgo"
        message="Su enlace de líder se desactivará y sus personas asignadas pasarán al líder superior más cercano."
        onConfirm={act(`/people/${p.id}/demote`, {}, 'Liderazgo retirado')} onClose={() => setModal(null)} />}
      {modal === 'deactivate' && <ConfirmModal title="Desactivar persona" reason reasonRequired danger confirmLabel="Desactivar"
        message="Sus enlaces dejarán de funcionar. Las relaciones con las personas que invitó se conservan."
        onConfirm={act(`/people/${p.id}/status`, { status: 'inactive' }, 'Persona desactivada')} onClose={() => setModal(null)} />}
      {modal === 'reactivate' && <ConfirmModal title="Reactivar persona" reason confirmLabel="Reactivar"
        onConfirm={act(`/people/${p.id}/status`, { status: 'active' }, 'Persona reactivada')} onClose={() => setModal(null)} />}
      {modal === 'approve' && <ConfirmModal title="Aprobar registro" reason confirmLabel="Aprobar"
        message={`${p.full_name} quedará activa en ${head.cabeza ? `el equipo de ${head.cabeza.full_name}` : head.name} y recibirá su invitación personal.`}
        onConfirm={act(`/people/${p.id}/status`, { status: 'active' }, 'Registro aprobado')} onClose={() => setModal(null)} />}
      {modal === 'reject' && <ConfirmModal title="Rechazar registro" reason reasonRequired danger confirmLabel="Rechazar"
        onConfirm={act(`/people/${p.id}/status`, { status: 'rejected' }, 'Registro rechazado')} onClose={() => setModal(null)} />}
      {modal === 'regen' && <ConfirmModal title={activeLink ? 'Regenerar enlace' : 'Generar enlace'} confirmLabel="Continuar"
        message={activeLink ? 'El enlace actual dejará de funcionar y se creará uno nuevo. Los registros anteriores se conservan.' : 'Se generará un enlace para compartir.'}
        onConfirm={async () => { await api.post(`/people/${p.id}/link`); done('Enlace generado'); }} onClose={() => setModal(null)} />}
    </div>
  );
}
