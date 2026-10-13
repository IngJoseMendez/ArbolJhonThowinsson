import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Ban, Check, CheckCircle2, Clock, Copy, Crown, Link2, Palette, Plus, Power, Search, Settings2, XCircle } from 'lucide-react';
import { ROLE_HELP, ROLE_LABEL, SWATCHES, clearRegTypes, useRegTypes, typeVars } from '../lib/regTypes.js';
import { api, qs } from '../api.js';
import { useAuth } from '../auth.jsx';
import { fmtDate, fmtNum, inviteUrl, relTime, phoneDisplay } from '../lib/format.js';
import { useQueryState } from '../lib/useParams.js';
import { ConfirmModal, ErrorBox, Loading, Modal, PersonLink, PersonPicker, ShareLink, copyText, useAsync, useToast, Empty } from '../components/ui.jsx';

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

export function TypeChip({ type, name, color }) {
  const n = name ?? type?.name; const c = color ?? type?.color;
  if (!n) return null;
  return <span className="type-chip" style={{ '--chip': c }}>{n}</span>;
}

function ColorPicker({ value, onChange }) {
  return (
    <div className="row-wrap" style={{ gap: 10 }}>
      <input type="color" className="color-input" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Color" />
      <div className="swatches">{SWATCHES.map((c) => (
        <button key={c} type="button" className={`swatch ${value === c ? 'active' : ''}`} style={{ background: c }} aria-label={`Color ${c}`} onClick={() => onChange(c)} />
      ))}</div>
    </div>
  );
}

function CreateLinkModal({ onClose, onDone }) {
  const a = useAuth();
  const types = useRegTypes();
  const heads = useAsync(() => api.get('/heads'), []);
  const active = types.list.filter((t) => t.active && (t.role !== 'head' || a.isSuper));
  const [typeId, setTypeId] = useState(null);
  const type = types.byId[typeId] || null;
  const [headId, setHeadId] = useState('');
  const [owner, setOwner] = useState(null);
  const [label, setLabel] = useState('');
  const [maxUses, setMaxUses] = useState('');
  const [expires, setExpires] = useState('');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(null);
  const headName = heads.data?.find((h) => String(h.id) === String(headId))?.name;
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const l = await api.post('/links', {
        reg_type_id: type.id, head_id: type.role === 'head' ? null : Number(headId) || null, owner_person_id: owner?.id ?? null,
        label: label || null, max_uses: maxUses === '' ? null : Number(maxUses), expires_at: expires ? `${expires}T23:59:59` : null,
      });
      setCreated(l); onDone();
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  if (created) {
    return (
      <Modal title="Enlace creado" onClose={onClose} footer={<button className="btn btn-primary" onClick={onClose}>Listo</button>}>
        <div className="stack" style={typeVars(type.color)}>
          <div className="type-banner" style={{ marginBottom: 0 }}><span className="type-banner-kicker">Registro de {ROLE_LABEL[type.role].toLowerCase()}</span>
            <span className="type-banner-name">{type.name}</span>{label && <span className="type-banner-sub">{label}</span>}</div>
          <p className="small text-2" style={{ margin: 0 }}>Así lo verán en el celular: con este color. {ROLE_HELP[type.role]}</p>
          <ShareLink token={created.token} headName={type.role === 'head' ? `una nueva estructura (${type.name})` : headName} ownerName={owner?.full_name} />
        </div>
      </Modal>
    );
  }
  const canSave = type && (type.role === 'head' || headId) && (type.role !== 'person' || owner);
  return (
    <Modal wide title="Nuevo enlace de registro" subtitle="El tipo decide qué se registra y el color con que se ve el formulario." onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" disabled={!canSave || busy} onClick={save}>{busy && <span className="spinner" />}Crear enlace</button></>}>
      <div className="stack">
        <div className="field"><label>Tipo de registro</label>
          <div className="type-grid" role="radiogroup">
            {active.map((t) => (
              <button key={t.id} type="button" role="radio" aria-checked={typeId === t.id} className={`type-card ${typeId === t.id ? 'active' : ''}`}
                style={{ '--chip': t.color }} onClick={() => { setTypeId(t.id); if (t.role === 'head' && maxUses === '') setMaxUses('1'); }}>
                <span className="type-card-bar" /><b>{t.name}</b><span className="small muted">{ROLE_LABEL[t.role]}</span>
              </button>
            ))}
          </div>
          {type && <span className="hint">{ROLE_HELP[type.role]}</span>}
        </div>
        {type && type.role !== 'head' && (
          <div className="grid g-2">
            <div className="field"><label>Cabeza</label>
              <select className="select" value={headId} onChange={(e) => { setHeadId(e.target.value); setOwner(null); }}>
                <option value="">Seleccione…</option>{heads.data?.filter((h) => h.status === 'active').map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
              </select></div>
            <div className="field"><label>{type.role === 'person' ? 'Cuelgan de' : 'Padrino (opcional)'}</label>
              <PersonPicker headId={headId || undefined} value={owner} onChange={setOwner} disabled={!headId} filter={(p) => p.status === 'active'}
                placeholder={headId ? 'Buscar persona o líder…' : 'Elija primero la cabeza'} />
              <span className="hint">{type.role === 'person' ? 'Las personas registradas quedarán invitadas por esta persona.' : 'Sin padrino, los líderes cuelgan directamente de la cabeza.'}</span></div>
          </div>
        )}
        <div className="grid g-3">
          <div className="field"><label>Nombre interno <span className="muted">(opcional)</span></label><input className="input" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={120} placeholder="Ej.: Zona norte, evento 12/10" /></div>
          <div className="field"><label>Máximo de registros</label><input className="input" type="number" min="1" value={maxUses} onChange={(e) => setMaxUses(e.target.value)} placeholder="Sin límite" /></div>
          <div className="field"><label>Caduca el</label><input className="input" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} /></div>
        </div>
        {type?.role === 'head' && <span className="small muted">Cada enlace de cabeza admite por defecto un solo registro: cree uno por persona.</span>}
        <ErrorBox error={err} />
      </div>
    </Modal>
  );
}

function TypeModal({ type, onClose, onDone }) {
  const [f, setF] = useState(type ? { name: type.name, color: type.color } : { name: '', role: 'leader', color: SWATCHES[4] });
  const [err, setErr] = useState(null);
  const save = async () => {
    try {
      if (type) await api.patch(`/reg-types/${type.id}`, { name: f.name, color: f.color });
      else await api.post('/reg-types', f);
      clearRegTypes(); onDone(type ? 'Tipo actualizado' : 'Tipo creado'); onClose();
    } catch (e) { setErr(e); }
  };
  return (
    <Modal title={type ? `Editar «${type.name}»` : 'Nuevo tipo de registro'} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" disabled={f.name.trim().length < 2} onClick={save}>Guardar</button></>}>
      <div className="stack">
        <div className="field"><label>Nombre</label><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={60} placeholder="Ej.: Voto seguro, Líder aspirante, Concejal" autoFocus /></div>
        {!type && (
          <div className="field"><label>Pertenece a</label>
            <div className="seg">{['head', 'leader', 'person'].map((r) => <button key={r} type="button" className={f.role === r ? 'active' : ''} onClick={() => setF({ ...f, role: r })}>{ROLE_LABEL[r]}</button>)}</div>
            <span className="hint">{ROLE_HELP[f.role]}</span></div>
        )}
        <div className="field"><label>Color</label><ColorPicker value={f.color} onChange={(color) => setF({ ...f, color })} /></div>
        <div style={typeVars(f.color)}><div className="type-banner" style={{ marginBottom: 0 }}><span className="type-banner-kicker">Vista previa</span><span className="type-banner-name">{f.name || 'Nombre del tipo'}</span></div></div>
        <ErrorBox error={err} />
      </div>
    </Modal>
  );
}

function TypesTab() {
  const a = useAuth();
  const toast = useToast();
  const types = useRegTypes();
  const [modal, setModal] = useState(null);
  const done = (m) => { toast(m); types.reload(); };
  const toggle = async (t) => {
    try { await api.patch(`/reg-types/${t.id}`, { active: !t.active }); clearRegTypes(); done(t.active ? 'Tipo desactivado' : 'Tipo activado'); }
    catch (e) { toast(e.message, 'error'); }
  };
  return (
    <>
      <div className="row-wrap" style={{ marginBottom: 12, justifyContent: 'space-between' }}>
        <p className="small text-2" style={{ margin: 0, maxWidth: 640 }}>Cada tipo pertenece a <b>Cabeza</b>, <b>Líder</b> o <b>Persona</b> y tiene un color: el formulario del enlace se muestra con ese color en el celular, y el tipo queda guardado en cada registro.</p>
        {a.isSuper && <button className="btn btn-primary" onClick={() => setModal({})}><Plus size={15} />Nuevo tipo</button>}
      </div>
      <div className="card">
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Tipo</th><th>Pertenece a</th><th>Registros</th><th>Estado</th><th /></tr></thead>
            <tbody>
              {types.list.map((t) => (
                <tr key={t.id}>
                  <td><div className="row" style={{ gap: 10 }}><span className="type-swatch" style={{ background: t.color }} /><b>{t.name}</b>{t.builtin ? <span className="badge badge-muted">Base</span> : null}</div></td>
                  <td>{ROLE_LABEL[t.role]}</td>
                  <td className="tnum">{fmtNum(t.people)}</td>
                  <td>{t.active ? <span className="badge badge-good">Activo</span> : <span className="badge badge-muted">Inactivo</span>}</td>
                  <td>{a.isSuper && (
                    <div className="row nowrap" style={{ gap: 4 }}>
                      <button className="btn btn-sm" onClick={() => setModal({ type: t })}><Palette size={14} />Editar</button>
                      {!t.builtin && <button className="btn btn-sm btn-ghost" onClick={() => toggle(t)}>{t.active ? 'Desactivar' : 'Activar'}</button>}
                    </div>
                  )}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {modal && <TypeModal type={modal.type} onClose={() => setModal(null)} onDone={done} />}
    </>
  );
}

function LinksTab() {
  const a = useAuth();
  const toast = useToast();
  const types = useRegTypes();
  const [f, setF] = useState({ q: '', kind: '', status: '', head_id: '', reg_type_id: '' });
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
          <option value="">Todos los enlaces</option><option value="register">Enlaces de registro</option><option value="leader">Enlaces de líder</option><option value="person">Invitaciones personales</option>
        </select>
        {a.isAdmin && (
          <select className="select" style={{ width: 170 }} value={f.reg_type_id} onChange={(e) => { setF({ ...f, reg_type_id: e.target.value }); setPage(1); }} aria-label="Tipo de registro">
            <option value="">Cualquier tipo</option>{types.list.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}
        <select className="select" style={{ width: 140 }} value={f.status} onChange={(e) => { setF({ ...f, status: e.target.value }); setPage(1); }} aria-label="Estado">
          <option value="">Todos</option><option value="active">Activos</option><option value="disabled">Desactivados</option>
        </select>
        {a.isAdmin && <button className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={() => setModal({ type: 'create' })}><Plus size={15} />Nuevo enlace de registro</button>}
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
                      <div className="row" style={{ gap: 6 }}>{l.kind === 'register' ? <span className="type-swatch" style={{ background: l.type_color }} /> : l.kind === 'leader' ? <Crown size={14} color="var(--leader)" /> : <Link2 size={14} className="muted" />}<span className="mono">{l.token}</span></div>
                      {l.kind === 'register' && <div className="row-wrap" style={{ gap: 6, margin: '3px 0' }}><TypeChip name={l.type_name} color={l.type_color} /><span className="small text-2">registra {ROLE_LABEL[l.type_role]?.toLowerCase()}s</span>{l.label && <span className="small"><b>{l.label}</b></span>}</div>}
                      <div className="small muted">{l.kind === 'register' ? 'Enlace de registro' : l.kind === 'leader' ? 'Enlace de líder' : 'Invitación personal'} · creado {fmtDate(l.created_at)}
                        {l.max_uses ? ` · máx. ${l.max_uses}` : ''}{l.expires_at ? ` · caduca ${fmtDate(l.expires_at)}` : ''}</div>
                    </td>
                    <td>{l.owner_person_id ? <PersonLink id={l.owner_person_id} name={l.owner_name} isLeader={l.owner_is_leader} /> : <span className="muted small">{l.type_role === 'head' ? 'Nueva cabeza' : 'Directo a la cabeza'}</span>}</td>
                    <td>{l.head_name ? <span className="row nowrap"><span className="dot" style={{ background: l.head_color }} />{l.head_name}</span> : <span className="muted small">Crea una nueva</span>}</td>
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
                        {l.status === 'active' && <a className="btn btn-sm btn-wa" href={`https://wa.me/?text=${encodeURIComponent(`Te invito a registrarte${l.kind === 'register' ? ` como ${l.type_name}` : ''}${l.head_name ? ` en ${l.head_name}` : ''}: ${inviteUrl(l.token)}`)}`} target="_blank" rel="noopener noreferrer">WhatsApp</a>}
                        {l.can_manage && l.status === 'active' && <button className="btn btn-sm btn-icon" title="Límites" aria-label="Límites" onClick={() => setModal({ type: 'limits', link: l })}><Settings2 size={14} /></button>}
                        {l.can_manage && l.status === 'active' && <button className="btn btn-sm btn-danger" onClick={() => setModal({ type: 'disable', link: l })}><Power size={14} />Desactivar</button>}
                        {l.can_manage && l.status !== 'active' && (l.kind === 'register' || l.owner_status === 'active') && <button className="btn btn-sm" onClick={() => setModal({ type: 'enable', link: l })}>Reactivar</button>}
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
      {modal?.type === 'create' && <CreateLinkModal onClose={() => setModal(null)} onDone={reload} />}
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
  const tab = params.tab === 'pendientes' && a.isAdmin ? 'pendientes' : params.tab === 'tipos' ? 'tipos' : 'enlaces';
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Enlaces e invitaciones</h1><p>Cada enlace identifica a quien invita. La cabeza y el invitador se determinan en el servidor a partir del enlace, nunca desde la URL.</p></div>
      </div>
      <div className="tabs">
        <button className={`tab ${tab === 'enlaces' ? 'active' : ''}`} onClick={() => setParams({ tab: null })}><Link2 size={14} /> Enlaces</button>
        <button className={`tab ${tab === 'tipos' ? 'active' : ''}`} onClick={() => setParams({ tab: 'tipos' })}><Palette size={14} /> Tipos y colores</button>
        {a.isAdmin && <button className={`tab ${tab === 'pendientes' ? 'active' : ''}`} onClick={() => setParams({ tab: 'pendientes' })}><Clock size={14} /> Pendientes de aprobación</button>}
      </div>
      {tab === 'enlaces' ? <LinksTab /> : tab === 'tipos' ? <TypesTab /> : <PendingTab />}
    </div>
  );
}
