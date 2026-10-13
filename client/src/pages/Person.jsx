import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Crown, GitBranch, Network, UserCheck, Send, Pencil, MoveRight, Power, CheckCircle2, XCircle, KeyRound, Users, Layers,
  ClipboardList, RefreshCw, ChevronRight, UserPlus, Info, Link2, ShieldCheck, ChevronsDown, MapPin, Eye,
} from 'lucide-react';
import { api, qs } from '../api.js';
import { useAuth } from '../auth.jsx';
import { fmtDate, fmtDateTime, fmtNum, METHOD, phoneDisplay, relTime } from '../lib/format.js';
import { BarList } from '../components/Charts.jsx';
import RegisterPersonModal from '../components/RegisterPersonModal.jsx';
import GeoSelect, { geoFromPerson, geoToApi } from '../components/GeoSelect.jsx';
import LeaderPicker from '../components/LeaderPicker.jsx';
import PanelLinkBox from '../components/PanelLinkBox.jsx';
import { useRegTypes } from '../lib/regTypes.js';
import {
  cedulaError, formatCedula, formatMobile, formatName, mobileError, normalizeCedula, normalizeMobile,
} from '../lib/validators.js';
import {
  Avatar, ConfirmModal, ErrorBox, Loading, Modal, PersonLink, PersonPicker, RoleBadge, ShareLink, StatusBadge, useAsync, useToast, Empty, HeadPill, LocationText,
} from '../components/ui.jsx';

const HISTORY = {
  registered: 'Registro',
  promoted_leader: 'Designado como líder oficial',
  demoted_leader: 'Retirado como líder',
  leader_changed: 'Cambio de líder responsable',
  moved: 'Movimiento dentro de la cabeza',
  moved_head: 'Cambio de cabeza',
  approved: 'Registro aprobado',
  rejected: 'Registro rechazado',
  deactivated: 'Desactivada',
  reactivated: 'Reactivada',
  data_updated: 'Datos actualizados',
  link_regenerated: 'Enlace de invitación regenerado',
  location_changed: 'Ubicación corregida',
  location_verified: 'Ubicación verificada',
};
const SUPPORTS = { yes: 'Sí', no: 'No' };
const FIELD = { reg_type_id: 'Tipo de registro', full_name: 'Nombre', first_names: 'Nombres', last_names: 'Apellidos', supports: '¿Contamos contigo?', secure_vote: '¿Es voto seguro?', phone: 'Celular', email: 'Correo', document_id: 'Cédula', address: 'Dirección', city: 'Municipio', notes: 'Observaciones' };

function HistoryDetail({ h, names }) {
  const d = h.details;
  const pn = (id) => (id ? names.people[id] || `#${id}` : 'ninguno');
  const hn = (id) => names.heads[id] || `#${id}`;
  switch (h.change_type) {
    case 'registered':
      return <>{METHOD[d.method]} en {d.head || hn(d.head_id)}. {d.inviter_id ? <>Invitado por <b>{pn(d.inviter_id)}</b>. </> : 'Cuelga directamente de la cabeza. '}
        {d.leader_id ? <>Líder responsable: <b>{pn(d.leader_id)}</b>{d.leader_mode === 'manual' ? ' (asignado)' : ''}.</> : ''}{d.is_leader ? ` Registrado como líder (${d.leader_code}).` : ''}</>;
    case 'promoted_leader': return <>Código asignado: <span className="mono">{d.leader_code}</span></>;
    case 'leader_changed': return <>De <b>{pn(d.from)}</b> a <b>{pn(d.to)}</b> {d.automatic ? '(recalculado automáticamente)' : d.mode === 'manual' ? '(asignación manual)' : '(automático)'}</>;
    case 'moved': case 'moved_head':
      if (d.via_branch_of) return <>Movida junto con la rama de <b>{pn(d.via_branch_of)}</b>: {hn(d.from_head_id)} → {hn(d.to_head_id)}</>;
      return <>{d.from_head_id !== d.to_head_id ? <>{hn(d.from_head_id)} → {hn(d.to_head_id)}. </> : ''}Invitador: {pn(d.from_inviter_id)} → <b>{pn(d.to_inviter_id)}</b>. Rama movida: {d.branch_size} personas.</>;
    case 'location_changed': case 'location_verified':
      return <>{d.to?.geo_status === 'pending' ? 'Ubicación escrita a mano (pendiente)' : 'Ubicación del catálogo asignada'}</>;
    case 'data_updated':
      return <>{Object.entries(d.fields || {}).map(([k, v]) => {
        const fmt = (x) => (k === 'supports' || k === 'secure_vote' ? SUPPORTS[x] : x) || '—';
        return <div key={k}>{FIELD[k] || k}: <s className="muted">{fmt(v.from)}</s> → {fmt(v.to)}</div>;
      })}</>;
    default: return null;
  }
}

/** Separa un nombre completo antiguo en nombres y apellidos (2+2, 1+2 o 1+1 palabras) como propuesta editable. */
function splitName(full) {
  const w = String(full || '').trim().split(/\s+/).filter(Boolean);
  const n = w.length >= 4 ? w.length - 2 : w.length === 3 ? 1 : Math.min(1, w.length);
  return { first_names: w.slice(0, n).join(' '), last_names: w.slice(n).join(' ') };
}

function EditModal({ p, types = [], onClose, onDone }) {
  const names = p.first_names || p.last_names ? { first_names: p.first_names || '', last_names: p.last_names || '' } : splitName(p.full_name);
  const [f, setF] = useState({
    ...names, phone: p.phone || '', document_id: p.document_id || '', address: p.address || '',
    supports: p.supports || '', secure_vote: p.secure_vote || '', reg_type_id: p.reg_type_id ? String(p.reg_type_id) : '', notes: p.notes || '', reason: '',
  });
  const typeOptions = types.filter((t) => (t.active || t.id === p.reg_type_id) && (p.is_leader ? t.role !== 'person' : t.role === 'person'));
  const [err, setErr] = useState(null);
  const [errors, setErrors] = useState({});
  const set = (k, fmt = (x) => x) => (e) => setF({ ...f, [k]: fmt(e.target.value) });
  const save = async () => {
    const e = {};
    if (!f.first_names.trim()) e.first_names = 'Escriba los nombres.';
    if (!f.last_names.trim()) e.last_names = 'Escriba los apellidos.';
    const c = f.document_id ? cedulaError(f.document_id) : (p.document_id ? 'La cédula es obligatoria.' : null); if (c) e.document_id = c;
    const m = mobileError(f.phone); if (m && normalizeMobile(f.phone) !== p.phone) e.phone = m;
    setErrors(e);
    if (Object.keys(e).length) return;
    try {
      await api.patch(`/people/${p.id}`, {
        ...f, first_names: formatName(f.first_names), last_names: formatName(f.last_names), phone: normalizeMobile(f.phone),
        document_id: normalizeCedula(f.document_id) || null, supports: f.supports || null, secure_vote: f.secure_vote || null, reg_type_id: f.reg_type_id || undefined,
      });
      onDone('Datos actualizados'); onClose();
    } catch (ex) { setErr(ex); if (ex.body?.error?.field) setErrors({ [ex.body.error.field]: ex.message }); }
  };
  const fe = (k) => errors[k] && <span className="err">{errors[k]}</span>;
  return (
    <Modal title="Editar datos" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" onClick={save}>Guardar</button></>}>
      <div className="stack">
        {!p.first_names && !p.last_names && <span className="small muted">Registro anterior con nombre completo: revise cómo quedaron separados nombres y apellidos.</span>}
        <div className="grid g-2">
          <div className="field"><label>Nombres</label><input className={`input ${errors.first_names ? 'invalid' : ''}`} value={f.first_names} maxLength={60} onChange={set('first_names')} onBlur={() => setF({ ...f, first_names: formatName(f.first_names) })} />{fe('first_names')}</div>
          <div className="field"><label>Apellidos</label><input className={`input ${errors.last_names ? 'invalid' : ''}`} value={f.last_names} maxLength={60} onChange={set('last_names')} onBlur={() => setF({ ...f, last_names: formatName(f.last_names) })} />{fe('last_names')}</div>
        </div>
        <div className="grid g-2">
          <div className="field"><label>Cédula</label><input className={`input ${errors.document_id ? 'invalid' : ''}`} inputMode="numeric" value={formatCedula(f.document_id)} onChange={set('document_id', normalizeCedula)} />{fe('document_id')}</div>
          <div className="field"><label>Celular / WhatsApp</label><input className={`input ${errors.phone ? 'invalid' : ''}`} type="tel" inputMode="numeric" value={formatMobile(f.phone)} onChange={set('phone', normalizeMobile)} />{fe('phone')}</div>
        </div>
        <div className="field"><label>Dirección</label><input className="input" value={f.address} onChange={set('address')} maxLength={200} />{fe('address')}</div>
        {typeOptions.length > 1 && (
          <div className="field"><label>Tipo de registro</label>
            <select className="select" value={f.reg_type_id} onChange={set('reg_type_id')}>
              {typeOptions.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select></div>
        )}
        <div className="grid g-2">
          <div className="field"><label>¿Es voto seguro?</label>
            <div className="seg">
              {[['yes', 'Sí'], ['no', 'No'], ['', 'Sin valorar']].map(([v, l]) => (
                <button key={v} type="button" className={f.secure_vote === v ? 'active' : ''} onClick={() => setF({ ...f, secure_vote: v })}>{l}</button>
              ))}
            </div><span className="hint">Valoración de quien registra.</span></div>
          <div className="field"><label>¿Contamos contigo? <span className="muted">(respuesta de la persona)</span></label>
            <div className="seg">
              {[['yes', 'Sí'], ['no', 'No'], ['', 'Sin respuesta']].map(([v, l]) => (
                <button key={v} type="button" className={f.supports === v ? 'active' : ''} onClick={() => setF({ ...f, supports: v })}>{l}</button>
              ))}
            </div></div>
        </div>
        <div className="field"><label>Observaciones</label><textarea className="textarea" value={f.notes} onChange={set('notes')} /></div>
        <div className="field"><label>Motivo del cambio (opcional)</label><input className="input" value={f.reason} onChange={set('reason')} /></div>
        <ErrorBox error={err} />
      </div>
    </Modal>
  );
}

function LocationModal({ p, location, onClose, onDone }) {
  const [geo, setGeo] = useState(geoFromPerson(location));
  const [reason, setReason] = useState('');
  const [err, setErr] = useState(null);
  const save = async () => {
    try { await api.post(`/people/${p.id}/location`, { location: geoToApi(geo), reason }); onDone('Ubicación actualizada'); onClose(); }
    catch (e) { setErr(e); }
  };
  return (
    <Modal wide title="Corregir ubicación" subtitle="Elija la ubicación del catálogo. Si la escribe a mano quedará pendiente de verificación." onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" onClick={save} disabled={!geo.localidad}>Guardar</button></>}>
      <div className="stack">
        {location?.status === 'pending' && (
          <div className="alert alert-warn"><Info size={16} /><span>Ubicación escrita a mano: <LocationText loc={location} /></span></div>
        )}
        <GeoSelect idPrefix="loc" value={geo} onChange={setGeo} />
        <div className="field"><label>Motivo (opcional)</label><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} /></div>
        <ErrorBox error={err} />
      </div>
    </Modal>
  );
}

function MoveModal({ p, head, onClose, onDone }) {
  const a = useAuth();
  const [target, setTarget] = useState(null);
  const [toHead, setToHead] = useState(false);
  const [headId, setHeadId] = useState(p.head_id);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState(null);
  const heads = useAsync(() => api.get('/heads'), []);
  const save = async () => {
    try {
      const r = await api.post(`/people/${p.id}/move`, toHead ? { inviter_id: null, head_id: Number(headId), reason } : { inviter_id: target.id, reason });
      onDone(`Rama movida (${r.branchSize} personas)`); onClose();
    } catch (e) { setErr(e); }
  };
  const cross = toHead ? Number(headId) !== p.head_id : target && target.head_id !== p.head_id;
  return (
    <Modal title="Mover persona y su rama" subtitle="Procedimiento autorizado: la persona se mueve con todas las personas que invitó. Queda registrado en el historial." onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" disabled={(!toHead && !target) || reason.trim().length < 5} onClick={save}>Mover</button></>}>
      <div className="stack">
        {p.is_leader && (
          <div className="seg">
            <button className={!toHead ? 'active' : ''} onClick={() => setToHead(false)}>Debajo de otra persona</button>
            <button className={toHead ? 'active' : ''} onClick={() => setToHead(true)}>Directamente bajo una cabeza</button>
          </div>
        )}
        {toHead ? (
          <div className="field"><label>Cabeza destino</label>
            <select className="select" value={headId} onChange={(e) => setHeadId(e.target.value)}>
              {heads.data?.filter((h) => h.can_manage && h.status === 'active').map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select></div>
        ) : (
          <div className="field"><label>Nuevo invitador</label>
            <PersonPicker headId={a.isSuper ? undefined : p.head_id} value={target} onChange={setTarget} filter={(x) => x.id !== p.id && x.status === 'active'} />
            <span className="hint">No se permite elegir a alguien de su propia rama (relación circular).</span></div>
        )}
        {cross && <div className="alert alert-warn"><Info size={16} /><span>La persona y toda su rama dejarán de pertenecer a <b>{head.name}</b>. Una persona nunca pertenece a dos cabezas a la vez.</span></div>}
        <div className="field"><label>Motivo (obligatorio)</label><textarea className="textarea" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} /></div>
        <ErrorBox error={err} />
      </div>
    </Modal>
  );
}

function LeaderModal({ p, onClose, onDone }) {
  const leaders = useAsync(() => api.get(`/leaders${qs({ head_id: p.head_id })}`), [p.head_id]);
  const [leaderId, setLeaderId] = useState(p.leader_mode === 'manual' ? String(p.leader_id || '') : '');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState(null);
  const save = async () => {
    try { await api.post(`/people/${p.id}/leader`, { leader_id: leaderId ? Number(leaderId) : null, reason }); onDone('Líder responsable actualizado'); onClose(); } catch (e) { setErr(e); }
  };
  return (
    <Modal title="Líder responsable" subtitle="La responsabilidad organizativa es independiente de quién invitó a la persona." onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" onClick={save}>Guardar</button></>}>
      <div className="stack">
        <LeaderPicker id="lm-leader" label="Líder" leaders={leaders.data} loading={leaders.loading} exclude={p.id}
          value={leaderId} onChange={setLeaderId}
          hint={leaderId ? 'Quite la selección (×) para volver al modo automático.' : 'Vacío = automático: el líder más cercano en su cadena de invitación.'} />
        <div className="field"><label>Motivo</label><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></div>
        <ErrorBox error={err} />
      </div>
    </Modal>
  );
}

function AccountModal({ p, onClose, onDone }) {
  const [f, setF] = useState({ username: p.full_name.split(' ')[0].toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '') + p.id, password: '' });
  const [err, setErr] = useState(null);
  const save = async () => {
    try { await api.post('/users', { ...f, role: p.is_leader ? 'leader' : 'member', person_id: p.id }); onDone('Acceso creado'); onClose(); } catch (e) { setErr(e); }
  };
  return (
    <Modal title="Crear acceso a la plataforma" subtitle={p.is_leader ? 'Cuenta de líder: podrá consultar su estructura.' : 'Cuenta de persona registrada: podrá ver su ficha, su rama y compartir su invitación.'} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" onClick={save} disabled={f.password.length < 8}>Crear acceso</button></>}>
      <div className="stack">
        <div className="field"><label>Usuario</label><input className="input" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} /></div>
        <div className="field"><label>Contraseña inicial (mín. 8)</label><input className="input" type="text" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></div>
        <ErrorBox error={err} />
      </div>
    </Modal>
  );
}

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
          <Avatar name={p.full_name} leader={p.is_leader} size="lg" />
          <div style={{ flex: 1, minWidth: 220 }}>
            <h1>{p.full_name}</h1>
            <div className="row-wrap" style={{ marginTop: 8 }}>
              <RoleBadge isLeader={p.is_leader} code={p.leader_code} />
              {types.byId[p.reg_type_id] && <span className="type-chip" style={{ '--chip': types.byId[p.reg_type_id].color }} title="Tipo de registro">{types.byId[p.reg_type_id].name}</span>}
              {!p.is_leader && invitees.length > 0 && <span className="badge" title="Ha invitado a otras personas sin ser líder oficial"><Send size={12} />Invita a otras personas · no es líder</span>}
              <StatusBadge status={p.status} />
              <HeadPill name={head.name} color={head.color} />
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
              {p.is_leader && <button className="btn btn-sm" onClick={() => setModal('demote')}><Crown size={14} />Retirar liderazgo</button>}
              <button className="btn btn-sm" onClick={() => setModal('leader')}><UserCheck size={14} />Cambiar líder responsable</button>
              {p.status !== 'rejected' && <button className="btn btn-sm" onClick={() => setModal('move')}><MoveRight size={14} />Mover rama</button>}
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
        <Rel icon={Network} color={head.color} label="Pertenencia · Cabeza" sub="Estructura a la que pertenece">{head.name}</Rel>
        <Rel icon={Crown} color="var(--leader)" label="Responsabilidad · Líder"
          sub={leader ? (p.leader_mode === 'manual' ? 'Asignado manualmente' : 'Líder más cercano en su cadena') : 'Sin líder por encima'}>
          {leader ? <PersonLink id={leader.id} name={leader.full_name} isLeader /> : '—'}
        </Rel>
        <Rel icon={Send} color="var(--series-1)" label="Invitación directa · Invitado por"
          sub={data.via_link ? `Mediante el enlace ${data.via_link.token}` : p.registration_method === 'manual' ? 'Asignado en registro manual' : ''}>
          {inviter ? <PersonLink id={inviter.id} name={inviter.full_name} isLeader={inviter.is_leader} /> : 'Cuelga de la cabeza'}
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
                <span className="crumb" style={{ background: `color-mix(in srgb, ${head.color} 16%, transparent)` }}><Network size={12} />{head.name}</span>
                {chain.map((c) => (
                  <span key={c.id} className="row" style={{ gap: 4 }}>
                    <ChevronRight size={14} className="sep" />
                    {c.id === p.id
                      ? <span className="crumb current">{c.is_leader && <Crown size={12} />}{c.full_name}</span>
                      : <Link to={`/personas/${c.id}`} className={`crumb ${c.is_leader ? 'leader' : ''}`}>{c.is_leader && <Crown size={12} />}{c.full_name}</Link>}
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
            <h2 className="row">{p.is_leader ? <><Crown size={16} color="var(--leader)" />Enlace de líder</> : <><Link2 size={16} />Invitación personal</>}</h2>
            {activeLink ? (
              <>
                <ShareLink token={activeLink.token} ownerName={p.full_name} headName={head.name} />
                <div className="small muted">{fmtNum(activeLink.uses)} registros con este enlace{activeLink.pending ? ` · ${activeLink.pending} pendientes` : ''}{activeLink.last_used ? ` · último ${relTime(activeLink.last_used)}` : ''}</div>
                <div className="small muted">Quien se registre con él quedará vinculado a {p.full_name.split(' ')[0]} como invitador, en {head.name}. La cabeza y el invitador se validan en el servidor.</div>
              </>
            ) : (
              <div className="small muted">{p.status !== 'active' ? 'Disponible cuando la persona esté activa.' : !p.is_leader && !head.person_invites_enabled ? 'Las invitaciones personales están deshabilitadas en esta cabeza.' : 'No tiene enlace activo.'}</div>
            )}
            {(perm.manage || perm.self) && p.status === 'active' && (p.is_leader || head.person_invites_enabled) && (
              <button className="btn btn-sm" onClick={() => setModal('regen')}><RefreshCw size={14} />{activeLink ? 'Regenerar enlace' : 'Generar enlace'}</button>
            )}
            {p.is_leader === false && <div className="alert alert-info small"><Info size={14} />Invitar no convierte a nadie en líder.</div>}
          </div>

          {p.is_leader && perm.manage && (
            <div className="card card-pad stack">
              <h2 className="row"><Eye size={16} />Panel de gestión</h2>
              <p className="small text-2" style={{ margin: 0 }}>Enlace privado de solo lectura para que {p.full_name.split(' ')[0]} vea su red sin usuario ni contraseña. Se abre con los últimos 4 dígitos de su cédula.</p>
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
          <PanelLinkBox token={panelToken} />
        </Modal>
      )}
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
        message={`${p.full_name} quedará activa en ${head.name} y recibirá su invitación personal.`}
        onConfirm={act(`/people/${p.id}/status`, { status: 'active' }, 'Registro aprobado')} onClose={() => setModal(null)} />}
      {modal === 'reject' && <ConfirmModal title="Rechazar registro" reason reasonRequired danger confirmLabel="Rechazar"
        onConfirm={act(`/people/${p.id}/status`, { status: 'rejected' }, 'Registro rechazado')} onClose={() => setModal(null)} />}
      {modal === 'regen' && <ConfirmModal title={activeLink ? 'Regenerar enlace' : 'Generar enlace'} confirmLabel="Continuar"
        message={activeLink ? 'El enlace actual dejará de funcionar y se creará uno nuevo. Los registros anteriores se conservan.' : 'Se generará un enlace para compartir.'}
        onConfirm={async () => { await api.post(`/people/${p.id}/link`); done('Enlace generado'); }} onClose={() => setModal(null)} />}
    </div>
  );
}
