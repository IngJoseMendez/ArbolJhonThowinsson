import { useEffect, useState } from 'react';
import { AlertCircle, Crown, Info, User } from 'lucide-react';
import { api, qs } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Modal, PersonPicker, useToast } from './ui.jsx';
import LeaderPicker from './LeaderPicker.jsx';
import { useRegTypes } from '../lib/regTypes.js';
import { Mark } from '../brand/Brand.jsx';
import PersonFields, { emptyPerson, validatePerson, personPayload, serverFieldError, normalizeMobile } from './PersonFields.jsx';

/** Registro manual por un administrador. Conserva quién registra y la rama asignada. */
export default function RegisterPersonModal({ onClose, onCreated, defaultHeadId, defaultInviter }) {
  const a = useAuth();
  const toast = useToast();
  const [heads, setHeads] = useState([]);
  const [headId, setHeadId] = useState(defaultHeadId || defaultInviter?.head_id || '');
  const [isLeader, setIsLeader] = useState(false);
  const types = useRegTypes();
  const [typeId, setTypeId] = useState(null);
  // Los tipos de cabeza registran a la cabeza de la estructura (sólo el administrador general).
  const typeChoices = types.list.filter((t) => t.active && (t.role !== 'head' || a.isSuper));
  const currentType = types.byId[typeId] || typeChoices.find((t) => t.builtin && t.role === (isLeader ? 'leader' : 'person'));
  const isHead = currentType?.role === 'head';
  const chooseType = (t) => { setTypeId(t.id); setIsLeader(t.role !== 'person'); if (t.role === 'head') setInviter(null); };
  const [inviter, setInviter] = useState(defaultInviter || null);
  const [leaders, setLeaders] = useState([]);
  const [leaderMode, setLeaderMode] = useState('auto');
  const [leaderId, setLeaderId] = useState('');
  const [f, setF] = useState(emptyPerson);
  const [notes, setNotes] = useState('');
  const [consent, setConsent] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitted, setSubmitted] = useState(false);
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

  const checkDup = async () => {
    if (normalizeMobile(f.phone).length < 10 && String(f.document_id).replace(/\D/g, '').length < 5) return setDup(null);
    const r = await api.get(`/people/check-duplicate${qs({ phone: normalizeMobile(f.phone), document_id: f.document_id })}`).catch(() => null);
    setDup(r?.duplicate || null);
  };

  const autoLeaderName = inviter ? (inviter.is_leader ? inviter.full_name : inviter.leader_name) : null;
  const head = heads.find((h) => String(h.id) === String(headId));

  const submit = async (e) => {
    e.preventDefault();
    setSubmitted(true);
    const v = validatePerson(f, { assessment: true });
    setFieldErrors(v);
    if (Object.keys(v).length) { setErr({ message: 'Revise los campos marcados.' }); return; }
    setErr(null); setBusy(true);
    try {
      const p = await api.post('/people', {
        ...personPayload(f), notes, consent, head_id: Number(headId), is_leader: isLeader, is_head: isHead, inviter_id: isHead ? null : inviter?.id ?? null,
        leader_id: leaderMode === 'manual' && leaderId ? Number(leaderId) : null, reg_type_id: currentType?.id ?? null,
      });
      toast(`${p.full_name} registrado correctamente`);
      onCreated?.(p);
      onClose();
    } catch (ex) { setErr(ex); setFieldErrors((x) => ({ ...x, ...serverFieldError(ex.body?.error) })); } finally { setBusy(false); }
  };

  const canSubmit = headId && (isLeader || inviter) && !(isHead && head?.cabeza_name) && !busy;

  return (
    <Modal wide title="Registrar persona" subtitle={`Registro manual realizado por ${a.user.display_name}. Quedará constancia en el historial.`} onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>Cancelar</button>
        <button className="btn btn-primary" form="reg-form" disabled={!canSubmit}>{busy && <span className="spinner" />}Registrar</button>
      </>}>
      <form id="reg-form" className="stack" onSubmit={submit} style={{ gap: 16 }}>
        <div className="grid g-2">
          <div className="field">
            <label htmlFor="r-head">Estructura</label>
            <select id="r-head" className="select" value={headId} onChange={(e) => setHeadId(e.target.value)} required>
              <option value="">Seleccione…</option>
              {heads.map((h) => <option key={h.id} value={h.id}>{h.cabeza_name ? `${h.cabeza_name} (cabeza)` : h.name}</option>)}
            </select>
            {isHead && head?.cabeza_name && <span className="err">Esta estructura ya tiene cabeza: {head.cabeza_name}.</span>}
          </div>
          <div className="field">
            <label>Tipo de registro</label>
            {typeChoices.length > 0 ? (
              <div className="type-grid compact" role="radiogroup">
                {typeChoices.map((t) => (
                  <button key={t.id} type="button" role="radio" aria-checked={currentType?.id === t.id} className={`type-card ${currentType?.id === t.id ? 'active' : ''}`}
                    style={{ '--chip': t.color }} onClick={() => chooseType(t)}>
                    <span className="type-card-bar" /><b className="row" style={{ gap: 5 }}>{t.role === 'person' ? <User size={13} /> : t.role === 'head' ? <Mark size={12} /> : <Crown size={13} />}{t.name}</b>
                  </button>
                ))}
              </div>
            ) : (
              <div className="seg" role="radiogroup">
                <button type="button" className={!isLeader ? 'active' : ''} onClick={() => setIsLeader(false)}><User size={14} />Persona</button>
                <button type="button" className={isLeader ? 'active' : ''} onClick={() => setIsLeader(true)}><Crown size={14} />Líder oficial</button>
              </div>
            )}
            <span className="hint">{isHead ? 'Quedará como cabeza de la estructura: invitará líderes y personas desde su panel.'
              : isLeader ? 'Quedará como líder oficial (código LID-…), con su link y su panel.' : 'Quedará como persona; invitar no la convierte en líder.'}</span>
          </div>
        </div>

        {!isHead && <div className="field">
          <label>Invitado directamente por {isLeader && <span className="muted">(opcional para líderes)</span>}</label>
          <PersonPicker headId={headId || undefined} value={inviter} onChange={setInviter} disabled={!headId}
            filter={(p) => p.status === 'active'}
            placeholder={headId ? 'Buscar a quien lo invitó en esta estructura…' : 'Seleccione primero la estructura'} />
          <span className="hint">
            {isLeader && !inviter
              ? (head?.cabeza_name ? `Sin invitador: el líder quedará con la cabeza, ${head.cabeza_name}.` : 'Sin invitador: el líder colgará directamente de la estructura.')
              : 'Aparecerá debajo de esta persona en el árbol de invitaciones.'}
          </span>
        </div>}

        {!isHead && <div className="field">
          <label>Líder responsable</label>
          <div className="row-wrap">
            <div className="seg">
              <button type="button" className={leaderMode === 'auto' ? 'active' : ''} onClick={() => setLeaderMode('auto')}>Automático</button>
              <button type="button" className={leaderMode === 'manual' ? 'active' : ''} onClick={() => setLeaderMode('manual')}>Asignar manualmente</button>
            </div>
            {leaderMode === 'manual' && (
              <div style={{ width: 300, maxWidth: '100%' }}>
                <LeaderPicker id="r-leader" leaders={leaders} value={leaderId} onChange={setLeaderId} compact />
              </div>
            )}
          </div>
          <span className="hint">
            {leaderMode === 'auto'
              ? (autoLeaderName ? <>Se asignará <b>{autoLeaderName}</b>: el líder oficial más cercano en la cadena de invitación.</> : 'Se asignará el líder oficial más cercano en la cadena de invitación (si existe).')
              : 'La responsabilidad organizativa es independiente de quién invitó a la persona.'}
          </span>
        </div>}

        <div className="divider" />
        <PersonFields idPrefix="r" assessment value={f} errors={fieldErrors}
          onChange={(v) => { setF(v); if (submitted) { const e2 = validatePerson(v, { assessment: true }); setFieldErrors(e2); if (!Object.keys(e2).length) setErr(null); } }}
          onBlurField={(k) => { if (k === 'phone' || k === 'document_id') checkDup(); }} />
        <div className="field">
          <label htmlFor="r-notes">Observaciones internas <span className="muted">(opcional)</span></label>
          <textarea id="r-notes" className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
        </div>
        {dup && (
          <div className="alert alert-warn"><AlertCircle size={16} />
            <span>Ya existe una persona con {dup.field === 'phone' ? 'ese celular' : 'esa cédula'}
              {dup.full_name ? <> : <a href={`/personas/${dup.id}`}>{dup.full_name}</a> ({dup.code})</> : ' (en una cabeza fuera de su alcance)'}. No se permiten registros duplicados.</span>
          </div>
        )}
        <label className="check">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span className="small text-2">La persona autorizó el tratamiento de sus datos para la gestión de la estructura organizativa.</span>
        </label>
        <div className="alert alert-info"><Info size={16} /><span>Registrar a alguien como persona no le da liderazgo. Un líder sólo existe por designación expresa de un administrador.</span></div>
        {err && <div className="alert alert-error"><AlertCircle size={16} />{err.message}</div>}
      </form>
    </Modal>
  );
}
