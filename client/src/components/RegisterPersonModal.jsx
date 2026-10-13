import { useEffect, useState } from 'react';
import { AlertCircle, Crown, Info, User } from 'lucide-react';
import { api, qs } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Modal, PersonPicker, useToast } from './ui.jsx';

/** Registro manual por un administrador. Conserva quién registra y la rama asignada. */
export default function RegisterPersonModal({ onClose, onCreated, defaultHeadId, defaultInviter }) {
  const a = useAuth();
  const toast = useToast();
  const [heads, setHeads] = useState([]);
  const [headId, setHeadId] = useState(defaultHeadId || defaultInviter?.head_id || '');
  const [isLeader, setIsLeader] = useState(false);
  const [inviter, setInviter] = useState(defaultInviter || null);
  const [leaders, setLeaders] = useState([]);
  const [leaderMode, setLeaderMode] = useState('auto');
  const [leaderId, setLeaderId] = useState('');
  const [f, setF] = useState({ full_name: '', phone: '', email: '', document_id: '', city: '', notes: '', consent: false });
  const [dup, setDup] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/heads').then((hs) => {
      const m = hs.filter((h) => h.can_manage && h.status === 'active');
      setHeads(m);
      if (!headId && m.length === 1) setHeadId(m[0].id);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!headId) { setLeaders([]); return; }
    api.get(`/leaders${qs({ head_id: headId })}`).then(setLeaders).catch(() => setLeaders([]));
    if (inviter && inviter.head_id !== Number(headId)) setInviter(null);
  }, [headId]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const checkDup = async () => {
    if (f.phone.replace(/\D/g, '').length < 7 && !f.document_id) return setDup(null);
    const r = await api.get(`/people/check-duplicate${qs({ phone: f.phone, document_id: f.document_id })}`).catch(() => null);
    setDup(r?.duplicate || null);
  };

  const autoLeaderName = inviter ? (inviter.is_leader ? inviter.full_name : inviter.leader_name) : null;

  const submit = async (e) => {
    e.preventDefault();
    setErr(null); setBusy(true);
    try {
      const p = await api.post('/people', {
        ...f, head_id: Number(headId), is_leader: isLeader, inviter_id: inviter?.id ?? null,
        leader_id: leaderMode === 'manual' && leaderId ? Number(leaderId) : null,
      });
      toast(`${p.full_name} registrado correctamente`);
      onCreated?.(p);
      onClose();
    } catch (ex) { setErr(ex); } finally { setBusy(false); }
  };

  const canSubmit = headId && f.full_name.trim().length >= 3 && f.phone && (isLeader || inviter) && !busy;

  return (
    <Modal wide title="Registrar persona" subtitle={`Registro manual realizado por ${a.user.display_name}. Quedará constancia en el historial.`} onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>Cancelar</button>
        <button className="btn btn-primary" form="reg-form" disabled={!canSubmit}>{busy && <span className="spinner" />}Registrar</button>
      </>}>
      <form id="reg-form" className="stack" onSubmit={submit} style={{ gap: 16 }}>
        <div className="grid g-2">
          <div className="field">
            <label htmlFor="r-head">Cabeza (pertenencia)</label>
            <select id="r-head" className="select" value={headId} onChange={(e) => setHeadId(e.target.value)} required>
              <option value="">Seleccione…</option>
              {heads.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Tipo de registro</label>
            <div className="seg" role="radiogroup">
              <button type="button" className={!isLeader ? 'active' : ''} onClick={() => setIsLeader(false)}><User size={14} />Persona</button>
              <button type="button" className={isLeader ? 'active' : ''} onClick={() => setIsLeader(true)}><Crown size={14} />Líder oficial</button>
            </div>
          </div>
        </div>

        <div className="field">
          <label>Invitado directamente por {isLeader && <span className="muted">(opcional para líderes)</span>}</label>
          <PersonPicker headId={headId || undefined} value={inviter} onChange={setInviter} disabled={!headId}
            filter={(p) => p.status === 'active'}
            placeholder={headId ? 'Buscar a quien lo invitó en esta cabeza…' : 'Seleccione primero la cabeza'} />
          <span className="hint">
            {isLeader && !inviter ? 'Sin invitador: el líder colgará directamente de la cabeza.' : 'Aparecerá debajo de esta persona en el árbol de invitaciones.'}
          </span>
        </div>

        <div className="field">
          <label>Líder responsable</label>
          <div className="row-wrap">
            <div className="seg">
              <button type="button" className={leaderMode === 'auto' ? 'active' : ''} onClick={() => setLeaderMode('auto')}>Automático</button>
              <button type="button" className={leaderMode === 'manual' ? 'active' : ''} onClick={() => setLeaderMode('manual')}>Asignar manualmente</button>
            </div>
            {leaderMode === 'manual' && (
              <select className="select" style={{ width: 260 }} value={leaderId} onChange={(e) => setLeaderId(e.target.value)}>
                <option value="">Seleccione un líder…</option>
                {leaders.map((l) => <option key={l.id} value={l.id}>{l.full_name} · {l.leader_code}</option>)}
              </select>
            )}
          </div>
          <span className="hint">
            {leaderMode === 'auto'
              ? (autoLeaderName ? <>Se asignará <b>{autoLeaderName}</b>: el líder oficial más cercano en la cadena de invitación.</> : 'Se asignará el líder oficial más cercano en la cadena de invitación (si existe).')
              : 'La responsabilidad organizativa es independiente de quién invitó a la persona.'}
          </span>
        </div>

        <div className="divider" />
        <div className="grid g-2">
          <div className="field span-2">
            <label htmlFor="r-name">Nombre completo</label>
            <input id="r-name" className="input" value={f.full_name} onChange={set('full_name')} required minLength={3} maxLength={120} autoComplete="off" />
          </div>
          <div className="field">
            <label htmlFor="r-phone">Teléfono (WhatsApp)</label>
            <input id="r-phone" className={`input ${dup?.field === 'phone' ? 'invalid' : ''}`} value={f.phone} onChange={set('phone')} onBlur={checkDup} inputMode="tel" required />
          </div>
          <div className="field">
            <label htmlFor="r-doc">Documento <span className="muted">(opcional)</span></label>
            <input id="r-doc" className={`input ${dup?.field === 'document_id' ? 'invalid' : ''}`} value={f.document_id} onChange={set('document_id')} onBlur={checkDup} />
          </div>
          <div className="field">
            <label htmlFor="r-email">Correo <span className="muted">(opcional)</span></label>
            <input id="r-email" type="email" className="input" value={f.email} onChange={set('email')} />
          </div>
          <div className="field">
            <label htmlFor="r-city">Municipio / barrio <span className="muted">(opcional)</span></label>
            <input id="r-city" className="input" value={f.city} onChange={set('city')} maxLength={80} />
          </div>
          <div className="field span-2">
            <label htmlFor="r-notes">Observaciones internas <span className="muted">(opcional)</span></label>
            <textarea id="r-notes" className="textarea" value={f.notes} onChange={set('notes')} maxLength={500} />
          </div>
        </div>
        {dup && (
          <div className="alert alert-warn"><AlertCircle size={16} />
            <span>Ya existe una persona con ese {dup.field === 'phone' ? 'teléfono' : 'documento'}
              {dup.full_name ? <> : <a href={`/personas/${dup.id}`}>{dup.full_name}</a> ({dup.code})</> : ' (en una cabeza fuera de su alcance)'}. No se permiten registros duplicados.</span>
          </div>
        )}
        <label className="check">
          <input type="checkbox" checked={f.consent} onChange={set('consent')} />
          <span className="small text-2">La persona autorizó el tratamiento de sus datos para la gestión de la estructura organizativa.</span>
        </label>
        <div className="alert alert-info"><Info size={16} /><span>Registrar a alguien como persona no le da liderazgo. Un líder sólo existe por designación expresa de un administrador.</span></div>
        {err && <div className="alert alert-error"><AlertCircle size={16} />{err.message}</div>}
      </form>
    </Modal>
  );
}
