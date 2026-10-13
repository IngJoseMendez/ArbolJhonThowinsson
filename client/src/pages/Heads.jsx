import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Archive, Plus, Network, Users, Crown, Clock, TrendingUp } from 'lucide-react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { fmtNum, HEAD_COLORS } from '../lib/format.js';
import { ErrorBox, Loading, Modal, useAsync, useToast, Empty } from '../components/ui.jsx';

export function HeadFormModal({ head, usedColors = [], onClose, onSaved }) {
  const a = useAuth();
  const toast = useToast();
  const nextColor = HEAD_COLORS.find((c) => !usedColors.includes(c)) || HEAD_COLORS[0];
  const [f, setF] = useState({
    name: head?.name || '', description: head?.description || '', region: head?.region || '', color: head?.color || nextColor,
    requires_approval: !!head?.requires_approval, person_invites_enabled: head ? !!head.person_invites_enabled : true,
  });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      const r = head ? await api.patch(`/heads/${head.id}`, f) : await api.post('/heads', f);
      toast(head ? 'Cabeza actualizada' : 'Cabeza creada');
      onSaved(r); onClose();
    } catch (ex) { setErr(ex); } finally { setBusy(false); }
  };
  const archive = async () => {
    try { await api.patch(`/heads/${head.id}`, { status: head.status === 'archived' ? 'active' : 'archived' }); toast('Estado actualizado'); onSaved(); onClose(); }
    catch (ex) { setErr(ex); }
  };
  return (
    <Modal title={head ? 'Editar cabeza' : 'Nueva cabeza'} subtitle="Cada cabeza es una estructura independiente con su propio árbol." onClose={onClose}
      footer={<>
        {head && a.isSuper && <button className="btn btn-danger" style={{ marginRight: 'auto' }} onClick={archive}><Archive size={15} />{head.status === 'archived' ? 'Reactivar' : 'Archivar'}</button>}
        <button className="btn" onClick={onClose}>Cancelar</button>
        <button className="btn btn-primary" form="head-form" disabled={busy}>{busy && <span className="spinner" />}Guardar</button>
      </>}>
      <form id="head-form" className="stack" onSubmit={submit}>
        <div className="field"><label htmlFor="hn">Nombre</label><input id="hn" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required minLength={2} maxLength={80} /></div>
        <div className="field"><label htmlFor="hr">Región / zona</label><input id="hr" className="input" value={f.region} onChange={(e) => setF({ ...f, region: e.target.value })} maxLength={80} /></div>
        <div className="field"><label htmlFor="hd">Descripción</label><textarea id="hd" className="textarea" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={500} /></div>
        <div className="field"><label>Color identificativo</label>
          <div className="row-wrap">
            {HEAD_COLORS.map((c) => (
              <button type="button" key={c} onClick={() => setF({ ...f, color: c })} aria-label={`Color ${c}`}
                style={{ width: 30, height: 30, borderRadius: 8, background: c, border: f.color === c ? '3px solid var(--text)' : '2px solid var(--surface)', boxShadow: 'var(--shadow-sm)', cursor: 'pointer' }} />
            ))}
          </div>
        </div>
        <label className="check"><input type="checkbox" checked={f.requires_approval} onChange={(e) => setF({ ...f, requires_approval: e.target.checked })} />
          <span><b>Aprobar registros por enlace</b><br /><span className="small muted">Los registros quedan pendientes hasta que un administrador los apruebe.</span></span></label>
        <label className="check"><input type="checkbox" checked={f.person_invites_enabled} onChange={(e) => setF({ ...f, person_invites_enabled: e.target.checked })} />
          <span><b>Invitaciones personales habilitadas</b><br /><span className="small muted">Cualquier persona registrada puede invitar a otras con su propio enlace (sin ser líder).</span></span></label>
        <ErrorBox error={err} />
      </form>
    </Modal>
  );
}

export default function Heads() {
  const a = useAuth();
  const nav = useNavigate();
  const { data, loading, error, reload } = useAsync(() => api.get('/heads'), []);
  const [creating, setCreating] = useState(false);
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Cabezas</h1><p>Estructuras principales. Cada una tiene su propio árbol, líderes y estadísticas.</p></div>
        {a.isSuper && <button className="btn btn-primary" onClick={() => setCreating(true)}><Plus size={16} />Nueva cabeza</button>}
      </div>
      {loading && <Loading />}
      <ErrorBox error={error} />
      {data && data.length === 0 && <div className="card"><Empty icon={Network} title="Aún no hay cabezas">{a.isSuper && <button className="btn btn-primary" onClick={() => setCreating(true)}>Crear la primera</button>}</Empty></div>}
      <div className="grid g-auto">
        {data?.map((h) => (
          <div key={h.id} className="card card-pad head-card stack" onClick={() => nav(`/cabezas/${h.id}`)} style={{ opacity: h.status === 'archived' ? 0.6 : 1 }}
            role="link" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && nav(`/cabezas/${h.id}`)}>
            <span className="stripe" style={{ background: h.color }} />
            <div className="row">
              <div className="brand-logo" style={{ background: h.color }}><Network size={17} /></div>
              <div style={{ minWidth: 0 }}>
                <h2 className="ellipsis">{h.name}</h2>
                <div className="small muted">{h.region || 'Sin región'}{h.status === 'archived' && ' · Archivada'}</div>
              </div>
            </div>
            {h.description && <div className="small text-2" style={{ minHeight: 20 }}>{h.description}</div>}
            {h.people != null && (
              <div className="grid g-2" style={{ gap: 10 }}>
                <div className="row small"><Users size={14} className="muted" /><b className="tnum">{fmtNum(h.people)}</b> personas</div>
                <div className="row small"><Crown size={14} color="var(--leader)" /><b className="tnum">{fmtNum(h.leaders)}</b> líderes</div>
                <div className="row small"><TrendingUp size={14} className="muted" /><b className="tnum">+{fmtNum(h.last30)}</b> en 30 días</div>
                <div className="row small"><Clock size={14} className="muted" /><b className="tnum">{fmtNum(h.pending)}</b> pendientes</div>
              </div>
            )}
            <div className="row-wrap">
              {h.requires_approval && <span className="badge badge-warning">Requiere aprobación</span>}
              {!h.person_invites_enabled && <span className="badge">Invitaciones personales desactivadas</span>}
            </div>
          </div>
        ))}
      </div>
      {creating && <HeadFormModal usedColors={(data || []).map((h) => h.color)} onClose={() => setCreating(false)} onSaved={(h) => { reload(); if (h?.id) nav(`/cabezas/${h.id}`); }} />}
    </div>
  );
}
