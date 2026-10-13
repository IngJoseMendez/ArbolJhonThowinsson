import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ChevronsDownUp, ChevronsUpDown, Filter, GitBranch, List, Network, X, Crown } from 'lucide-react';
import { api, qs } from '../api.js';
import { useAuth } from '../auth.jsx';
import { TreeStore } from '../lib/treeStore.js';
import { fmtNum } from '../lib/format.js';
import TreeCanvas from './TreeCanvas.jsx';
import TreeList from './TreeList.jsx';
import NodePanel from './NodePanel.jsx';
import RegisterPersonModal from './RegisterPersonModal.jsx';
import { PersonPicker, Loading, ErrorBox, useToast } from './ui.jsx';

/**
 * Explorador del árbol de una cabeza. Estado sincronizable con la URL a través de `params`/`setParams`
 * (cabeza, foco, persona, vista).
 */
export default function TreeExplorerView({ heads, params, setParams, lockHead }) {
  const a = useAuth();
  const toast = useToast();
  const headId = Number(params.cabeza) || heads[0]?.id;
  const head = heads.find((h) => h.id === headId);
  const focusId = Number(params.foco) || null;
  const view = params.vista === 'lista' ? 'lista' : 'arbol';

  const [store, setStore] = useState(null);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [pathIds, setPathIds] = useState(null);
  const [foundId, setFoundId] = useState(null);
  const [scrollToId, setScrollToId] = useState(null);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({ status: '', from: '', to: '' });
  const [leaders, setLeaders] = useState([]);
  const [focusNode, setFocusNode] = useState(null);
  const [registerFor, setRegisterFor] = useState(null);
  const canvas = useRef(null);
  const pendingLocate = useRef(Number(params.persona) || null);

  const version = useSyncExternalStore(
    useCallback((cb) => (store ? store.subscribe(cb) : () => {}), [store]),
    () => (store ? store.version : 0),
  );

  useEffect(() => {
    if (!headId) return;
    api.get(`/leaders${qs({ head_id: headId })}`).then(setLeaders).catch(() => setLeaders([]));
  }, [headId]);

  // (Re)construye el almacén cuando cambia la cabeza o el foco.
  useEffect(() => {
    if (!head) return;
    let alive = true;
    setError(null); setStore(null); setPathIds(null); setFoundId(null);
    (async () => {
      try {
        let focus = null;
        if (focusId) {
          const { chain } = await api.get(`/tree/path/${focusId}`);
          focus = chain[chain.length - 1];
          if (focus.head_id !== head.id) { setParams({ foco: null }); return; }
        }
        if (!alive) return;
        setFocusNode(focus);
        const s = new TreeStore(head, focus);
        await s.expand(s.rootKey);
        // Expansión inicial prudente: sólo ramas pequeñas, para que estructuras grandes sigan legibles.
        const autoExpand = async (keys, levels) => {
          let budget = 12;
          for (let l = 0; l < levels; l++) {
            const next = [];
            for (const k of keys) {
              const n = s.get(k);
              if (budget <= 0 || !n || n.kind !== 'person' || n.data.child_count === 0 || n.data.child_count > 8) continue;
              budget--;
              await s.expand(k);
              next.push(...(n.children || []));
            }
            keys = next;
          }
        };
        const rootChildren = s.get(s.rootKey).children || [];
        if (!focus && !a.isAdmin && rootChildren[0]) { await s.expand(rootChildren[0]); await autoExpand(s.get(rootChildren[0]).children || [], 1); }
        else await autoExpand(rootChildren, focus ? 2 : 1);
        if (!alive) return;
        setStore(s);
        const target = pendingLocate.current;
        pendingLocate.current = null;
        if (target) setTimeout(() => locateIn(s, target), 50);
        else setTimeout(() => canvas.current?.fit(), 50);
      } catch (e) { if (alive) setError(e); }
    })();
    return () => { alive = false; };
  }, [head?.id, focusId]); // eslint-disable-line react-hooks/exhaustive-deps

  const locateIn = async (s, personId) => {
    try {
      const chain = await s.locate(personId);
      if (!chain) {
        // Fuera de la rama enfocada: volver al árbol completo y localizar ahí.
        pendingLocate.current = personId;
        setParams({ foco: null });
        return;
      }
      setPathIds(new Set(chain.map((c) => c.id)));
      setFoundId(personId);
      setSelected(personId);
      setScrollToId(personId);
      setTimeout(() => canvas.current?.centerOn(`p${personId}`), 180);
    } catch (e) { toast(e.message, 'error'); }
  };

  const onSearchPick = (p) => {
    if (!p) return;
    if (p.head_id !== headId) {
      pendingLocate.current = p.id;
      setParams({ cabeza: p.head_id, foco: null, persona: null });
      return;
    }
    locateIn(store, p.id);
  };

  const highlight = async (id) => {
    const { chain } = await api.get(`/tree/path/${id}`);
    setPathIds(new Set(chain.map((c) => c.id)));
    await locateIn(store, id);
  };

  const isDimmed = useMemo(() => {
    const { status, from, to } = filters;
    if (!status && !from && !to) return null;
    return (n) => {
      if (n.kind !== 'person') return false;
      const d = n.data;
      if (status && d.status !== status) return true;
      if (from && d.created_at.slice(0, 10) < from) return true;
      if (to && d.created_at.slice(0, 10) > to) return true;
      return false;
    };
  }, [filters]);

  const matchCount = useMemo(() => {
    if (!store || !isDimmed) return null;
    let total = 0; let match = 0;
    for (const n of store.nodes.values()) if (n.kind === 'person') { total++; if (!isDimmed(n)) match++; }
    return { total, match };
  }, [store, version, isDimmed]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeFilters = (filters.status ? 1 : 0) + (filters.from ? 1 : 0) + (filters.to ? 1 : 0);

  if (!head) return <div className="page"><ErrorBox error={{ message: 'No hay cabezas disponibles.' }} /></div>;

  return (
    <>
      <div className="tree-bar">
        {!lockHead && (
          <select className="select" style={{ width: 180 }} value={headId} aria-label="Cabeza"
            onChange={(e) => { setSelected(null); setParams({ cabeza: e.target.value, foco: null, persona: null }); }}>
            {heads.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
          </select>
        )}
        <div style={{ width: 260, maxWidth: '100%' }}>
          <PersonPicker headId={a.isSuper ? undefined : headId} value={null} onChange={onSearchPick} placeholder="Buscar y localizar en el árbol…" />
        </div>
        <select className="select" style={{ width: 180 }} value={focusNode?.is_leader ? focusNode.id : ''} aria-label="Filtrar por líder"
          onChange={(e) => setParams({ foco: e.target.value || null, persona: null })}>
          <option value="">Todos los líderes</option>
          {leaders.map((l) => <option key={l.id} value={l.id}>{l.full_name}</option>)}
        </select>
        <button className={`btn ${activeFilters ? 'btn-primary' : ''}`} onClick={() => setShowFilters((x) => !x)}>
          <Filter size={15} />Filtros{activeFilters ? ` (${activeFilters})` : ''}
        </button>
        <div className="spacer" />
        {store && (
          <>
            <button className="btn btn-sm" title="Expandir dos niveles bajo la selección" onClick={() => store.expandLevels(selected ? `p${selected}` : store.rootKey, 2, 30)}><ChevronsUpDown size={14} /><span className="hide-sm">Expandir</span></button>
            <button className="btn btn-sm" title="Contraer todo" onClick={() => { store.collapseAll(); setTimeout(() => canvas.current?.fit(), 30); }}><ChevronsDownUp size={14} /><span className="hide-sm">Contraer</span></button>
          </>
        )}
        <div className="seg" role="tablist" aria-label="Vista">
          <button className={view === 'arbol' ? 'active' : ''} onClick={() => setParams({ vista: null })}><Network size={14} />Árbol</button>
          <button className={view === 'lista' ? 'active' : ''} onClick={() => setParams({ vista: 'lista' })}><List size={14} />Lista</button>
        </div>
      </div>
      {focusNode && (
        <div className="tree-bar" style={{ paddingTop: 8, paddingBottom: 8, background: 'var(--accent-soft)' }}>
          <GitBranch size={15} />
          <span>Viendo la rama de <b>{focusNode.full_name}</b>{focusNode.is_leader && <Crown size={12} color="var(--leader)" style={{ marginLeft: 4 }} />} · {fmtNum(focusNode.descendant_count)} personas debajo</span>
          <button className="btn btn-sm" onClick={() => setParams({ foco: null })}><X size={14} />Ver árbol completo</button>
        </div>
      )}
      {matchCount && (
        <div className="tree-bar small" style={{ paddingTop: 6, paddingBottom: 6 }}>
          Filtro activo: {fmtNum(matchCount.match)} de {fmtNum(matchCount.total)} nodos cargados coinciden; el resto se muestra atenuado para no romper la estructura.
          <button className="btn btn-sm btn-ghost" onClick={() => setFilters({ status: '', from: '', to: '' })}>Limpiar</button>
        </div>
      )}
      <div className="tree-shell">
        {showFilters && (
          <div className="card card-pad filters-panel stack" style={{ boxShadow: 'var(--shadow-lg)' }}>
            <div className="row"><h3>Filtros</h3><span className="spacer" /><button className="btn btn-ghost btn-sm btn-icon" onClick={() => setShowFilters(false)} aria-label="Cerrar"><X size={16} /></button></div>
            <div className="field"><label>Estado</label>
              <select className="select" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
                <option value="">Todos</option><option value="active">Activas</option><option value="pending">Pendientes</option><option value="inactive">Inactivas</option>
              </select>
            </div>
            <div className="field"><label>Registradas desde</label><input type="date" className="input" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} /></div>
            <div className="field"><label>Registradas hasta</label><input type="date" className="input" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} /></div>
            <span className="small muted">Para filtrar por líder, use el selector de líderes: el árbol se centra en su rama.</span>
          </div>
        )}
        {error && <div className="page"><ErrorBox error={error} /></div>}
        {!store && !error && <div style={{ flex: 1 }}><Loading /></div>}
        {store && view === 'arbol' && (
          <TreeCanvas ref={canvas} store={store} version={version} selectedId={selected} pathIds={pathIds} foundId={foundId}
            isDimmed={isDimmed} headColor={head.color} onSelect={(n) => setSelected(n.data.id)} />
        )}
        {store && view === 'lista' && (
          <TreeList store={store} version={version} selectedId={selected} pathIds={pathIds} isDimmed={isDimmed}
            headColor={head.color} scrollToId={scrollToId} onSelect={(n) => setSelected(n.data.id)} />
        )}
        {selected && (
          <NodePanel personId={selected} headName={head.name} onClose={() => setSelected(null)}
            canRegister={a.canManageHead(headId)}
            onRegisterInvitee={(p) => setRegisterFor({ id: p.id, full_name: p.full_name, head_id: p.head_id, is_leader: p.is_leader, code: p.code, leader_code: p.leader_code, leader_name: null, status: p.status })}
            onFocus={(id) => { setSelected(null); setParams({ foco: id, persona: null }); }}
            onHighlight={highlight} />
        )}
      </div>
      {registerFor && (
        <RegisterPersonModal defaultHeadId={headId} defaultInviter={registerFor} onClose={() => setRegisterFor(null)}
          onCreated={async (p) => {
            const parentKey = `p${registerFor.id}`;
            const parent = store.get(parentKey);
            if (parent) { parent.data.child_count = (parent.data.child_count || 0) + 1; parent.children = null; await store.loadChildren(parentKey); }
            locateIn(store, p.id);
          }} />
      )}
    </>
  );
}
