import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ChevronDown, ChevronRight, MapPin, AlertTriangle, Plus, Pencil, Upload, Check, Power, Users, FolderTree,
} from 'lucide-react';
import { api, qs } from '../api.js';
import { useAuth } from '../auth.jsx';
import { fmtNum, fmtDate } from '../lib/format.js';
import { useQueryState } from '../lib/useParams.js';
import GeoSelect, { emptyGeo, geoToApi, clearGeoCache } from '../components/GeoSelect.jsx';
import { ErrorBox, Loading, Modal, Empty, useAsync, useToast } from '../components/ui.jsx';

const KIND = { localidad: 'Localidad', comuna: 'Comuna', corregimiento: 'Corregimiento', barrio: 'Barrio', vereda: 'Vereda' };
const SOURCE = { ALC: 'Alcaldía', ICBF: 'ICBF', SEC: 'Fuente secundaria (verificar)', ADMIN: 'Administrador', IMPORT: 'Importación' };

function buildTree(areas) {
  const byParent = new Map();
  for (const a of areas) {
    const k = a.parent_id || 0;
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k).push(a);
  }
  return byParent;
}

// ---------------------------------------------------------------- Conteos por ubicación
function StatsTab() {
  const heads = useAsync(() => api.get('/heads'), []);
  const [headId, setHeadId] = useState('');
  const { data, loading, error } = useAsync(() => api.get(`/geo/stats${qs({ head_id: headId })}`), [headId]);
  const [open, setOpen] = useState(() => new Set());
  const [hideEmpty, setHideEmpty] = useState(true);
  const byParent = useMemo(() => (data ? buildTree(data.areas.filter((a) => a.active || a.people)) : new Map()), [data]);
  const toggle = (id) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const link = (a) => {
    const p = { head_id: headId };
    if (a.level === 'localidad') p.localidad_id = a.id;
    if (a.level === 'comuna') { p.localidad_id = a.parent_id; p.comuna_id = a.id; }
    if (a.level === 'barrio') {
      const c = data.areas.find((x) => x.id === a.parent_id);
      Object.assign(p, { localidad_id: c?.parent_id, comuna_id: a.parent_id, barrio_id: a.id });
    }
    return `/personas${qs(p)}`;
  };
  const rows = [];
  const walk = (parentId, depth) => {
    for (const a of byParent.get(parentId) || []) {
      if (hideEmpty && !a.people && a.level !== 'localidad') continue;
      const kids = (byParent.get(a.id) || []).filter((k) => !hideEmpty || k.people);
      rows.push({ a, depth, kids: kids.length });
      if (open.has(a.id)) walk(a.id, depth + 1);
    }
  };
  if (data) walk(0, 0);

  return (
    <div className="stack">
      <div className="row-wrap">
        <select className="select" style={{ width: 220 }} value={headId} onChange={(e) => setHeadId(e.target.value)} aria-label="Cabeza">
          <option value="">Todas las cabezas</option>
          {heads.data?.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
        </select>
        <label className="check"><input type="checkbox" checked={hideEmpty} onChange={(e) => setHideEmpty(e.target.checked)} /><span className="small">Ocultar ubicaciones sin personas</span></label>
        <button className="btn btn-sm btn-ghost" onClick={() => setOpen(new Set(data?.areas.filter((a) => a.level !== 'barrio').map((a) => a.id)))}>Expandir todo</button>
        <button className="btn btn-sm btn-ghost" onClick={() => setOpen(new Set())}>Contraer todo</button>
      </div>
      <ErrorBox error={error} />
      {loading && !data && <Loading />}
      {data && (
        <>
          <div className="grid g-3">
            <div className="card stat"><div className="label"><Users size={16} />Personas</div><div className="value">{fmtNum(data.totals.total)}</div></div>
            <Link className="card stat" to={`/personas${qs({ geo_status: 'pending', head_id: headId })}`} style={{ textDecoration: 'none', color: 'inherit' }}>
              <div className="label"><AlertTriangle size={16} />Ubicación por verificar</div><div className="value">{fmtNum(data.totals.pending)}</div><div className="sub">Escritas a mano · ver listado</div>
            </Link>
            <Link className="card stat" to={`/personas${qs({ geo_status: 'none', head_id: headId })}`} style={{ textDecoration: 'none', color: 'inherit' }}>
              <div className="label"><MapPin size={16} />Sin ubicación</div><div className="value">{fmtNum(data.totals.without_location)}</div><div className="sub">Registros anteriores a este campo</div>
            </Link>
          </div>
          <div className="card loc-tree">
            <div className="loc-row" style={{ fontWeight: 600, fontSize: 12, color: 'var(--muted)' }}><span>Localidad › Comuna / corregimiento › Barrio / vereda</span><span>Personas</span><span /></div>
            {rows.length === 0 && <Empty icon={MapPin} title="Sin personas ubicadas todavía" />}
            {rows.map(({ a, depth, kids }) => (
              <div key={a.id} className="loc-row">
                <span className="row" style={{ paddingLeft: depth * 22, gap: 6, minWidth: 0 }}>
                  {kids > 0
                    ? <button className="btn btn-ghost btn-sm btn-icon" onClick={() => toggle(a.id)} aria-label={open.has(a.id) ? 'Contraer' : 'Expandir'}>{open.has(a.id) ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</button>
                    : <span style={{ width: 30 }} />}
                  <span className="ellipsis" style={{ fontWeight: a.level === 'localidad' ? 650 : 500 }}>{a.name}</span>
                  {a.alias && a.level !== 'barrio' && <span className="small muted ellipsis">{a.alias}</span>}
                  {a.kind === 'corregimiento' || a.kind === 'vereda' ? <span className="badge">{KIND[a.kind]}</span> : null}
                </span>
                <span className="count">{fmtNum(a.people)}</span>
                <Link className="btn btn-sm" to={link(a)} aria-label={`Ver personas de ${a.name}`}><Users size={14} /><span className="hide-sm">Ver personas</span></Link>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Revisión de ubicaciones escritas a mano
function ResolveModal({ group, onClose, onDone }) {
  const a = useAuth();
  const toast = useToast();
  const level = group.level;
  const initial = {
    localidad: group.geo_localidad_id ? { id: group.geo_localidad_id, name: group.localidad_name } : null,
    comuna: group.geo_comuna_id ? { id: group.geo_comuna_id, name: group.comuna_name, kind: group.comuna_kind } : null,
    barrio: null,
  };
  const [mode, setMode] = useState(a.isSuper ? 'add' : 'assign');
  const [geo, setGeo] = useState(initial);
  const written = group[`geo_${level}_text`];
  const [name, setName] = useState(written);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const parent = level === 'barrio' ? initial.comuna : level === 'comuna' ? initial.localidad : null;
  const canAdd = a.isSuper && (level === 'localidad' || parent);

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      let target;
      if (mode === 'add') {
        const area = await api.post('/geo/areas', { level, name, parent_id: parent?.id ?? null, kind: level === 'barrio' && initial.comuna?.kind === 'corregimiento' ? 'vereda' : undefined });
        clearGeoCache();
        target = { ...geoToApi(initial), [`${level}_id`]: area.id };
        // Niveles inferiores que también se escribieron a mano siguen pendientes.
        if (level === 'localidad' && group.geo_comuna_text) target.comuna_text = group.geo_comuna_text;
        if (level !== 'barrio' && group.geo_barrio_text) target.barrio_text = group.geo_barrio_text;
      } else {
        target = geoToApi(geo);
      }
      const r = await api.post('/geo/pending/resolve', { group, target });
      toast(`${r.updated} persona${r.updated === 1 ? '' : 's'} actualizada${r.updated === 1 ? '' : 's'}`);
      onDone();
      onClose();
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };

  return (
    <Modal wide title={`Revisar «${written}»`} subtitle={`Nivel: ${level === 'comuna' ? 'comuna o corregimiento' : KIND[level].toLowerCase()}. Escrito a mano por ${group.people} persona${group.people === 1 ? '' : 's'}.`} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" disabled={busy || (mode === 'add' ? !name.trim() : !geo.localidad)} onClick={submit}>{busy && <span className="spinner" />}{mode === 'add' ? 'Agregar al catálogo y asignar' : 'Asignar a todas'}</button></>}>
      <div className="stack">
        <div className="seg">
          {canAdd && <button className={mode === 'add' ? 'active' : ''} onClick={() => setMode('add')}><Plus size={14} />Agregar al catálogo</button>}
          <button className={mode === 'assign' ? 'active' : ''} onClick={() => setMode('assign')}><Check size={14} />Corregir: usar una existente</button>
        </div>
        {mode === 'add' ? (
          <>
            <div className="field"><label>Nombre oficial</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
              <span className="hint">Se creará como {KIND[level === 'barrio' && initial.comuna?.kind === 'corregimiento' ? 'vereda' : level].toLowerCase()} {parent ? <>dentro de <b>{parent.name}</b></> : 'nueva'}. Revise la ortografía antes de agregarla.</span></div>
          </>
        ) : (
          <>
            <GeoSelect idPrefix="rv" value={geo} onChange={setGeo} />
            <span className="small muted">Todas las personas que escribieron «{written}» en este mismo contexto pasarán a la ubicación elegida.</span>
          </>
        )}
        {!a.isSuper && <span className="small muted">Sólo el administrador general puede ampliar el catálogo.</span>}
        <ErrorBox error={err} />
      </div>
    </Modal>
  );
}

function PendingTab() {
  const { data, loading, error, reload } = useAsync(() => api.get('/geo/pending'), []);
  const [modal, setModal] = useState(null);
  if (loading && !data) return <Loading />;
  return (
    <div className="card">
      <ErrorBox error={error} />
      {data?.length === 0 && <Empty icon={Check} title="No hay ubicaciones pendientes de verificación" />}
      {data?.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Escrito a mano</th><th>Nivel</th><th>Contexto del catálogo</th><th>Personas</th><th>Desde</th><th /></tr></thead>
            <tbody>
              {data.map((g, i) => (
                <tr key={i}>
                  <td><b>{g[`geo_${g.level}_text`]}</b>
                    {g.level !== 'barrio' && g.geo_barrio_text && <div className="small muted">Barrio: {g.geo_barrio_text}</div>}
                    {g.level === 'localidad' && g.geo_comuna_text && <div className="small muted">Comuna: {g.geo_comuna_text}</div>}</td>
                  <td>{g.level === 'comuna' ? 'Comuna / corregimiento' : KIND[g.level]}</td>
                  <td className="small">{[g.localidad_name, g.comuna_name].filter(Boolean).join(' › ') || <span className="muted">—</span>}</td>
                  <td>
                    <Link to={`/personas${qs({ geo_status: 'pending', q: g[`geo_${g.level}_text`] })}`}>{fmtNum(g.people)}</Link>
                  </td>
                  <td className="small">{fmtDate(g.first_seen)}</td>
                  <td><button className="btn btn-sm btn-primary" onClick={() => setModal(g)}>Revisar</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {modal && <ResolveModal group={modal} onClose={() => setModal(null)} onDone={reload} />}
    </div>
  );
}

// ---------------------------------------------------------------- Catálogo (administrador general)
function AreaModal({ area, parent, level, onClose, onDone, all }) {
  const [f, setF] = useState({
    name: area?.name || '', alias: area?.alias || '', kind: area?.kind || (level === 'comuna' ? 'comuna' : level === 'barrio' ? (parent?.kind === 'corregimiento' ? 'vereda' : 'barrio') : 'localidad'),
    parent_id: area?.parent_id || parent?.id || '', source: area?.source || 'ADMIN',
  });
  const [err, setErr] = useState(null);
  const lv = area?.level || level;
  const parents = all.filter((a) => a.level === (lv === 'barrio' ? 'comuna' : lv === 'comuna' ? 'localidad' : '__'));
  const kinds = lv === 'localidad' ? ['localidad'] : lv === 'comuna' ? ['comuna', 'corregimiento'] : ['barrio', 'vereda'];
  const save = async () => {
    try {
      if (area) await api.patch(`/geo/areas/${area.id}`, { name: f.name, alias: f.alias, kind: f.kind, parent_id: lv === 'localidad' ? null : Number(f.parent_id) });
      else await api.post('/geo/areas', { level: lv, name: f.name, alias: f.alias, kind: f.kind, parent_id: lv === 'localidad' ? null : Number(f.parent_id) });
      clearGeoCache(); onDone(); onClose();
    } catch (e) { setErr(e); }
  };
  return (
    <Modal title={area ? `Editar ${KIND[area.kind].toLowerCase()}` : `Nueva ${lv === 'localidad' ? 'localidad' : lv === 'comuna' ? 'comuna o corregimiento' : 'barrio o vereda'}`} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" onClick={save} disabled={!f.name.trim()}>Guardar</button></>}>
      <div className="stack">
        <div className="grid g-2">
          <div className="field"><label>Nombre</label><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={120} /></div>
          <div className="field"><label>Tipo</label><select className="select" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{kinds.map((k) => <option key={k} value={k}>{KIND[k]}</option>)}</select></div>
        </div>
        {lv !== 'barrio' && <div className="field"><label>Descripción / nombre tradicional</label><input className="input" value={f.alias} onChange={(e) => setF({ ...f, alias: e.target.value })} maxLength={120} placeholder="Ej.: Histórica – Rodrigo de Bastidas" /></div>}
        {lv !== 'localidad' && (
          <div className="field"><label>Pertenece a</label>
            <select className="select" value={f.parent_id} onChange={(e) => setF({ ...f, parent_id: e.target.value })}>
              <option value="">Seleccione…</option>
              {parents.map((p) => <option key={p.id} value={p.id}>{p.name}{p.alias ? ` · ${p.alias}` : ''}</option>)}
            </select>
            {area && <span className="hint">Si la mueve, las personas ya ubicadas aquí se actualizan para seguir siendo coherentes.</span>}
          </div>
        )}
        <ErrorBox error={err} />
      </div>
    </Modal>
  );
}

function ImportModal({ onClose, onDone }) {
  const [text, setText] = useState('localidad;comuna;barrio;tipo;fuente\n');
  const [res, setRes] = useState(null);
  const [err, setErr] = useState(null);
  const rows = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const sep = rows[0]?.includes(';') ? ';' : ',';
  const header = rows[0]?.toLowerCase().split(sep).map((h) => h.trim()) || [];
  const hasHeader = header.includes('localidad');
  const cols = hasHeader ? header : ['localidad', 'comuna', 'barrio', 'tipo', 'fuente'];
  const parsed = (hasHeader ? rows.slice(1) : rows).map((l) => Object.fromEntries(l.split(sep).map((v, i) => [cols[i], v.trim()])));
  const run = async () => {
    try { setRes(await api.post('/geo/import', { rows: parsed })); clearGeoCache(); onDone(); } catch (e) { setErr(e); }
  };
  return (
    <Modal wide title="Importar ubicaciones (CSV)" subtitle="Una fila por ubicación: localidad;comuna;barrio;tipo;fuente. No se crean duplicados (se comparan nombres sin tildes ni mayúsculas dentro del mismo nivel superior)." onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cerrar</button><button className="btn btn-primary" onClick={run} disabled={!parsed.length || !!res}><Upload size={15} />Importar {fmtNum(parsed.length)} filas</button></>}>
      <div className="stack">
        <textarea className="textarea mono" style={{ minHeight: 220 }} value={text} onChange={(e) => { setText(e.target.value); setRes(null); }} />
        <span className="small muted">Tipo: «comuna» o «corregimiento» para el segundo nivel; «barrio» o «vereda» para el tercero. Puede pegar directamente desde una hoja de cálculo exportada a CSV.</span>
        {res && <div className="alert alert-good">Creadas: <b>{res.created}</b> · Ya existían: <b>{res.existing}</b>{res.errors.length ? ` · Filas con error: ${res.errors.map((e) => `${e.fila} (${e.error})`).join(', ')}` : ''}</div>}
        <ErrorBox error={err} />
      </div>
    </Modal>
  );
}

function CatalogTab() {
  const { data, loading, error, reload } = useAsync(() => api.get('/geo/areas?all=1'), []);
  const toast = useToast();
  const [open, setOpen] = useState(() => new Set());
  const [modal, setModal] = useState(null);
  const [term, setTerm] = useState('');
  const byParent = useMemo(() => (data ? buildTree(data) : new Map()), [data]);
  const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const toggle = (id) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const setActive = async (a) => {
    try { await api.patch(`/geo/areas/${a.id}`, { active: !a.active }); clearGeoCache(); toast(a.active ? 'Desactivada: ya no aparece en los formularios' : 'Reactivada'); reload(); } catch (e) { toast(e.message, 'error'); }
  };
  const rows = [];
  const match = (a) => !term || norm(`${a.name} ${a.alias}`).includes(norm(term));
  const walk = (pid, depth) => {
    for (const a of byParent.get(pid) || []) {
      const kids = byParent.get(a.id) || [];
      const visibleKid = term && kids.some((k) => match(k) || (byParent.get(k.id) || []).some(match));
      if (term && !match(a) && !visibleKid) continue;
      rows.push({ a, depth, kids: kids.length });
      if (open.has(a.id) || visibleKid) walk(a.id, depth + 1);
    }
  };
  if (data) walk(0, 0);
  return (
    <div className="stack">
      <div className="row-wrap">
        <input className="input" style={{ width: 260 }} placeholder="Buscar en el catálogo…" value={term} onChange={(e) => setTerm(e.target.value)} />
        <span className="spacer" />
        <button className="btn" onClick={() => setModal({ type: 'import' })}><Upload size={15} />Importar CSV</button>
        <button className="btn btn-primary" onClick={() => setModal({ type: 'area', level: 'localidad' })}><Plus size={15} />Nueva localidad</button>
      </div>
      <div className="alert alert-info small"><FolderTree size={15} /><span>Fuentes y limitaciones de la carga inicial en <code>docs/geografia-santa-marta.md</code>. Los barrios con fuente «Fuente secundaria» deben confirmarse con el POT o la Secretaría de Planeación.</span></div>
      <ErrorBox error={error} />
      {loading && !data && <Loading />}
      <div className="card loc-tree">
        {rows.map(({ a, depth, kids }) => (
          <div key={a.id} className="loc-row" style={{ gridTemplateColumns: '1fr auto auto', opacity: a.active ? 1 : 0.5 }}>
            <span className="row" style={{ paddingLeft: depth * 22, gap: 6, minWidth: 0 }}>
              {a.level !== 'barrio'
                ? <button className="btn btn-ghost btn-sm btn-icon" onClick={() => toggle(a.id)} aria-label="Expandir">{open.has(a.id) ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</button>
                : <span style={{ width: 30 }} />}
              <span className="ellipsis" style={{ fontWeight: a.level === 'localidad' ? 650 : 500 }}>{a.name}</span>
              {a.alias && <span className="small muted ellipsis">{a.alias}</span>}
              <span className="badge">{KIND[a.kind]}</span>
              {a.level !== 'barrio' && <span className="small muted">{kids} {a.level === 'localidad' ? 'unidades' : 'barrios/veredas'}</span>}
              {!a.active && <span className="badge badge-muted">Inactiva</span>}
            </span>
            <span className={`badge ${a.source === 'SEC' ? 'badge-warning' : 'badge-outline'}`} title="Fuente">{SOURCE[a.source] || a.source}</span>
            <span className="row nowrap" style={{ gap: 2 }}>
              {a.level !== 'barrio' && <button className="btn btn-sm btn-ghost btn-icon" title="Agregar dentro" aria-label="Agregar dentro" onClick={() => setModal({ type: 'area', level: a.level === 'localidad' ? 'comuna' : 'barrio', parent: a })}><Plus size={14} /></button>}
              <button className="btn btn-sm btn-ghost btn-icon" title="Editar" aria-label="Editar" onClick={() => setModal({ type: 'area', area: a })}><Pencil size={14} /></button>
              <button className="btn btn-sm btn-ghost btn-icon" title={a.active ? 'Desactivar' : 'Reactivar'} aria-label={a.active ? 'Desactivar' : 'Reactivar'} onClick={() => setActive(a)}><Power size={14} /></button>
            </span>
          </div>
        ))}
      </div>
      {modal?.type === 'area' && <AreaModal {...modal} all={data || []} onClose={() => setModal(null)} onDone={reload} />}
      {modal?.type === 'import' && <ImportModal onClose={() => setModal(null)} onDone={reload} />}
    </div>
  );
}

export default function Locations() {
  const a = useAuth();
  const [params, setParams] = useQueryState();
  const tab = params.tab || 'conteos';
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Ubicaciones</h1><p>Personas por localidad, comuna y barrio de Santa Marta; revisión de ubicaciones escritas a mano y catálogo geográfico.</p></div>
      </div>
      <div className="tabs">
        <button className={`tab ${tab === 'conteos' ? 'active' : ''}`} onClick={() => setParams({ tab: null })}><MapPin size={14} /> Personas por ubicación</button>
        {a.isAdmin && <button className={`tab ${tab === 'verificar' ? 'active' : ''}`} onClick={() => setParams({ tab: 'verificar' })}><AlertTriangle size={14} /> Por verificar</button>}
        {a.isSuper && <button className={`tab ${tab === 'catalogo' ? 'active' : ''}`} onClick={() => setParams({ tab: 'catalogo' })}><FolderTree size={14} /> Catálogo</button>}
      </div>
      {tab === 'conteos' && <StatsTab />}
      {tab === 'verificar' && a.isAdmin && <PendingTab />}
      {tab === 'catalogo' && a.isSuper && <CatalogTab />}
    </div>
  );
}
