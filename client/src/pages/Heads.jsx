import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Archive, GitBranch, Plus, Network, Send } from 'lucide-react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { fmtNum, HEAD_COLORS, initials } from '../lib/format.js';
import { photoSrc } from '../lib/photos.js';
import { ErrorBox, Loading, Modal, useAsync, useToast, Empty } from '../components/ui.jsx';
import { CAMPAIGN, JohnPhoto, Mark } from '../brand/Brand.jsx';

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
    <Modal title={head ? 'Editar estructura' : 'Nueva estructura'} subtitle={`Cada estructura cuelga de ${CAMPAIGN} y tiene su propio árbol. Su cabeza es la persona que la encabeza: regístrela después con el tipo «Cabeza» o desígnela desde su ficha.`} onClose={onClose}
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

/** John, la primera cabeza: de él cuelga toda la red (sus cabezas y las personas que invita). Abre el árbol completo. */
function JohnCard({ heads, totals, onOpen }) {
  const sum = (k) => heads.reduce((n, h) => n + (h[k] || 0), 0);
  return (
    <div className="card head-card" onClick={onOpen} style={{ '--hc': 'var(--sky)' }} role="link" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onOpen()}>
      <span className="stripe" style={{ background: 'var(--sky)' }} />
      <div className="head-card-top">
        <span className="head-avatar has-photo" aria-hidden="true"><JohnPhoto sizes="58px" alt="" /><Mark /></span>
        <div style={{ minWidth: 0 }}>
          <div className="head-name clamp-2">{CAMPAIGN}</div>
          <div className="head-struct ellipsis">De él cuelga toda la red</div>
        </div>
      </div>
      {totals && (
        <div className="head-metrics">
          <div><b className="tnum">{fmtNum(heads.filter((h) => !h.is_direct).length)}</b><span>cabezas</span></div>
          <div><b className="tnum">{fmtNum(sum('people'))}</b><span>personas</span></div>
          <div><b className="tnum">+{fmtNum(sum('last30'))}</b><span>en 30 días</span></div>
          <div><b className="tnum">{fmtNum(sum('pending'))}</b><span>pendientes</span></div>
        </div>
      )}
    </div>
  );
}

/** La cabeza es una persona: la tarjeta la muestra a ella al frente de su estructura. */
function HeadCard({ h, onOpen }) {
  const name = h.cabeza_name || h.name;
  const structure = h.cabeza_name && h.name !== `Cabeza ${h.cabeza_name}` ? h.name : null;
  return (
    <div className="card head-card" onClick={onOpen} style={{ opacity: h.status === 'archived' ? 0.6 : 1, '--hc': h.color }}
      role="link" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onOpen()}>
      <span className="stripe" style={{ background: h.color }} />
      <div className="head-card-top">
        <span className={`head-avatar ${h.cabeza_name ? '' : 'vacant'} ${h.cabeza_photo ? 'has-photo' : ''}`} aria-hidden="true">
          {h.cabeza_photo ? <img src={photoSrc(h.cabeza_photo, 58)} alt="" loading="lazy" /> : h.cabeza_name ? initials(h.cabeza_name) : <Network size={24} />}
          {h.cabeza_name && <Mark />}
        </span>
        <div style={{ minWidth: 0 }}>
          <div className="head-name clamp-2">{name}</div>
          <div className="head-struct ellipsis">
            {h.cabeza_name ? (structure || `Cabeza de ${CAMPAIGN}`) : 'Estructura sin cabeza asignada'}
            {h.region ? ` · ${h.region}` : ''}{h.status === 'archived' ? ' · Archivada' : ''}
          </div>
        </div>
      </div>
      {(h.requires_approval || !h.person_invites_enabled || h.cabeza_status === 'inactive') && (
        <div className="head-tags">
          {h.cabeza_status === 'inactive' && <span className="badge badge-muted">Cabeza inactiva</span>}
          {h.requires_approval && <span className="badge badge-warning">Aprueba registros</span>}
          {!h.person_invites_enabled && <span className="badge">Sin invitaciones personales</span>}
        </div>
      )}
      {h.people != null && (
        <div className="head-metrics">
          <div><b className="tnum">{fmtNum(h.leaders)}</b><span>líderes</span></div>
          <div><b className="tnum">{fmtNum(h.people)}</b><span>personas</span></div>
          <div><b className="tnum">+{fmtNum(h.last30)}</b><span>en 30 días</span></div>
          <div><b className="tnum">{fmtNum(h.pending)}</b><span>pendientes</span></div>
        </div>
      )}
    </div>
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
        <div><h1>Cabezas</h1><p>Todas cuelgan de {CAMPAIGN}, la primera cabeza; de él también cuelgan las personas que invita directamente. Cada
          cabeza es una persona al frente de su estructura: de ella salen sus líderes y, de cada líder, sus personas.</p></div>
        <div className="row-wrap">
          <Link className="btn" to="/arbol"><GitBranch size={16} />Ver la red completa</Link>
          {a.isSuper && <Link className="btn btn-primary" to="/enlaces"><Send size={16} />Invitar una cabeza</Link>}
          {a.isSuper && <button className="btn" onClick={() => setCreating(true)}><Plus size={16} />Nueva estructura</button>}
        </div>
      </div>
      {loading && <Loading />}
      <ErrorBox error={error} />
      <div className="grid g-auto">
        {data && <JohnCard heads={data.filter((h) => h.status === 'active')} totals={a.isSuper} onOpen={() => nav('/arbol')} />}
        {data?.filter((h) => !h.is_direct).map((h) => <HeadCard key={h.id} h={h} onOpen={() => nav(`/cabezas/${h.id}`)} />)}
      </div>
      {data && !data.some((h) => !h.is_direct) && <div className="card" style={{ marginTop: 16 }}><Empty icon={Network} title="Aún no hay cabezas">{a.isSuper && <Link className="btn btn-primary" to="/enlaces">Invitar la primera</Link>}</Empty></div>}
      {creating && <HeadFormModal usedColors={(data || []).map((h) => h.color)} onClose={() => setCreating(false)} onSaved={(h) => { reload(); if (h?.id) nav(`/cabezas/${h.id}`); }} />}
    </div>
  );
}
