// Diálogos de la ficha de una persona (editar, ubicación, mover, líder a cargo, acceso) y su historial en palabras.
// Los usan la ficha del computador y la del celular (en el celular se abren como hojas).
import { useState } from 'react';
import { Info } from 'lucide-react';
import { api, qs } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { METHOD } from '../../lib/format.js';
import GeoSelect, { geoFromPerson, geoToApi } from '../GeoSelect.jsx';
import LeaderPicker from '../LeaderPicker.jsx';
import {
  cedulaError, formatCedula, formatMobile, formatName, mobileError, normalizeCedula, normalizeMobile,
} from '../../lib/validators.js';
import { ErrorBox, Modal, PersonPicker, useAsync, LocationText } from '../ui.jsx';

export const HISTORY = {
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
  panel_recovered: 'Volvió a su panel con su link de registro (cédula y celular)',
  head_assigned: 'Designada como cabeza de la estructura',
  head_removed: 'Dejó de ser la cabeza de la estructura',
  location_changed: 'Ubicación corregida',
  location_verified: 'Ubicación verificada',
};
export const SUPPORTS = { yes: 'Sí', no: 'No' };
export const FIELD = { reg_type_id: 'Tipo de registro', full_name: 'Nombre', first_names: 'Nombres', last_names: 'Apellidos', supports: '¿Contamos contigo?', secure_vote: '¿Es voto seguro?', phone: 'Celular', email: 'Correo', document_id: 'Cédula', address: 'Dirección', city: 'Municipio', notes: 'Observaciones' };

export function HistoryDetail({ h, names }) {
  const d = h.details;
  const pn = (id) => (id ? names.people[id] || `#${id}` : 'ninguno');
  const hn = (id) => names.heads[id] || `#${id}`;
  switch (h.change_type) {
    case 'registered':
      return <>{METHOD[d.method]} en {d.head || hn(d.head_id)}. {d.inviter_id ? <>Invitado por <b>{pn(d.inviter_id)}</b>. </> : d.is_head ? 'Es la raíz de su estructura. ' : 'Cuelga directamente de la estructura. '}
        {d.leader_id ? <>Líder responsable: <b>{pn(d.leader_id)}</b>{d.leader_mode === 'manual' ? ' (asignado)' : ''}.</> : ''}{d.is_head ? ' Registrada como cabeza de la estructura.' : d.is_leader ? ` Registrado como líder (${d.leader_code}).` : ''}</>;
    case 'promoted_leader': return <>Código asignado: <span className="mono">{d.leader_code}</span></>;
    case 'head_assigned': return d.adopted ? <>{d.adopted} líderes que colgaban de la estructura pasaron a colgar de ella.</> : null;
    case 'leader_changed': return <>De <b>{pn(d.from)}</b> a <b>{pn(d.to)}</b> {d.automatic ? '(recalculado automáticamente)' : d.mode === 'manual' ? '(asignación manual)' : '(automático)'}</>;
    case 'moved': case 'moved_head':
      if (d.adopted_by_head) return <>Pasó a colgar de la cabeza <b>{pn(d.to_inviter_id)}</b> con toda su rama ({d.branch_size} personas).</>;
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
export function splitName(full) {
  const w = String(full || '').trim().split(/\s+/).filter(Boolean);
  const n = w.length >= 4 ? w.length - 2 : w.length === 3 ? 1 : Math.min(1, w.length);
  return { first_names: w.slice(0, n).join(' '), last_names: w.slice(n).join(' ') };
}

export function EditModal({ p, types = [], onClose, onDone }) {
  const names = p.first_names || p.last_names ? { first_names: p.first_names || '', last_names: p.last_names || '' } : splitName(p.full_name);
  const [f, setF] = useState({
    ...names, phone: p.phone || '', document_id: p.document_id || '', address: p.address || '',
    supports: p.supports || '', secure_vote: p.secure_vote || '', reg_type_id: p.reg_type_id ? String(p.reg_type_id) : '', notes: p.notes || '', reason: '',
  });
  const role = p.is_head ? 'head' : p.is_leader ? 'leader' : 'person';
  const typeOptions = types.filter((t) => (t.active || t.id === p.reg_type_id) && t.role === role);
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

export function LocationModal({ p, location, onClose, onDone }) {
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

export function MoveModal({ p, head, onClose, onDone }) {
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
            <button className={toHead ? 'active' : ''} onClick={() => setToHead(true)}>Con la cabeza de una estructura</button>
          </div>
        )}
        {toHead ? (
          <div className="field"><label>Estructura destino</label>
            <select className="select" value={headId} onChange={(e) => setHeadId(e.target.value)}>
              {heads.data?.filter((h) => h.can_manage && h.status === 'active').map((h) => <option key={h.id} value={h.id}>{h.cabeza_name ? `${h.cabeza_name} (cabeza)` : h.name}</option>)}
            </select>
            <span className="hint">Si la estructura tiene cabeza, el líder quedará colgando de ella.</span></div>
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

export function LeaderModal({ p, onClose, onDone }) {
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

export function AccountModal({ p, onClose, onDone }) {
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
