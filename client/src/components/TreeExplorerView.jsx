import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  ChevronDown, ChevronsDown, ChevronsUp, Filter, GitBranch, List, Network, X, Crown, RefreshCw, MapPin,
} from 'lucide-react';
import { api, qs } from '../api.js';
import { useAuth } from '../auth.jsx';
import { TreeStore, getCachedTree, putCachedTree, loadTreeState, saveTreeState } from '../lib/treeStore.js';
import { fmtNum } from '../lib/format.js';
import TreeCanvas from './TreeCanvas.jsx';
import TreeList from './TreeList.jsx';
import NodePanel from './NodePanel.jsx';
import RegisterPersonModal from './RegisterPersonModal.jsx';
import GeoSelect, { emptyGeo } from './GeoSelect.jsx';
import LeaderPicker from './LeaderPicker.jsx';
import { PersonPicker, Loading, ErrorBox, useToast } from './ui.jsx';

const emptyFilters = { status: '', from: '', to: '', geo: emptyGeo, geoPending: false };

/**
 * Explorador del árbol de una cabeza. Estado sincronizable con la URL a través de `params`/`setParams`
 * (cabeza, foco, persona, vista, expandir=todo). El estado de expansión, zoom, selección y filtros se
 * conserva al navegar a otra página y volver (memoria) y al recargar (sessionStorage).
 */
export default function TreeExplorerView({ heads, params, setParams, lockHead }) {
  const a = useAuth();
  const toast = useToast();
  const headId = Number(params.cabeza) || heads[0]?.id;
  const head = heads.find((h) => h.id === headId);
  const focusId = Number(params.foco) || null;
  const view = params.vista === 'lista' ? 'lista' : 'arbol';
  const cacheKey = `${a.user?.id}:${headId}:${focusId || ''}`;

  const [store, setStore] = useState(null);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [pathIds, setPathIds] = useState(null);
  const [foundId, setFoundId] = useState(null);
  const [scrollToId, setScrollToId] = useState(null);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState(emptyFilters);
  const [leaders, setLeaders] = useState([]);
  const [focusNode, setFocusNode] = useState(null);
  const [registerFor, setRegisterFor] = useState(null);
  const [initialTransform, setInitialTransform] = useState(null);
  const canvas = useRef(null);
  const pendingLocate = useRef(Number(params.persona) || null);
  const pendingExpandAll = useRef(params.expandir === 'todo');

  const version = useSyncExternalStore(
    useCallback((cb) => (store ? store.subscribe(cb) : () => {}), [store]),
    () => (store ? store.version : 0),
  );

  useEffect(() => {
    if (!headId) return;
    api.get(`/leaders${qs({ head_id: headId })}`).then(setLeaders).catch(() => setLeaders([]));
  }, [headId]);

  const applyUi = (ui = {}) => {
    setSelected(ui.selected ?? null);
    setPathIds(ui.pathIds ? new Set(ui.pathIds) : null);
    setFoundId(ui.foundId ?? null);
    setFilters(ui.filters ? { ...emptyFilters, ...ui.filters } : emptyFilters);
    setInitialTransform(ui.t || null);
  };

  // (Re)construye o recupera el almacén cuando cambia la cabeza o el foco.
  useEffect(() => {
    if (!head) return;
    let alive = true;
    setError(null);
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

        // 1) Volver desde otra página: el mismo árbol, tal como se dejó.
        const cached = getCachedTree(cacheKey);
        if (cached) {
          applyUi(cached.ui);
          setStore(cached);
          afterReady(cached, true);
          // Refresco silencioso de los datos manteniendo exactamente las ramas abiertas.
          if (Date.now() - cached.builtAt > 30e3) refreshStore(cached, focus);
          return;
        }
        setStore(null);
        const s = new TreeStore(head, focus);
        s.builtAt = Date.now();
        const saved = loadTreeState(cacheKey);
        if (saved?.tree) {
          // 2) Recarga de la página: se restauran las ramas abiertas desde sessionStorage.
          await s.restore(saved.tree);
          s.ui = saved.ui || {};
          if (!alive) return;
          applyUi(s.ui);
        } else {
          // 3) Primera visita: expansión inicial prudente (sólo ramas pequeñas).
          await s.expand(s.rootKey);
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
          s.ui = {};
          applyUi({});
        }
        if (!alive) return;
        putCachedTree(cacheKey, s);
        setStore(s);
        afterReady(s, !!saved?.ui?.t);
      } catch (e) { if (alive) setError(e); }
    })();
    return () => { alive = false; };
  }, [head?.id, focusId]); // eslint-disable-line react-hooks/exhaustive-deps

  const afterReady = (s, keepView) => {
    const target = pendingLocate.current;
    pendingLocate.current = null;
    if (pendingExpandAll.current) {
      pendingExpandAll.current = false;
      setParams({ expandir: null }, true);
      runExpandAll(s, s.rootKey);
    }
    if (target) setTimeout(() => locateIn(s, target), 50);
    else if (!keepView) setTimeout(() => canvas.current?.fit(), 50);
  };

  const refreshStore = async (old, focus) => {
    try {
      const s = new TreeStore(head, focus ?? focusNode);
      s.builtAt = Date.now();
      await s.restore(old.snapshot());
      s.ui = old.ui;
      putCachedTree(cacheKey, s);
      setStore((cur) => (cur === old ? s : cur));
    } catch { /* se mantiene la versión en memoria */ }
  };

  // Guarda el estado (ramas abiertas, selección, filtros y vista) en memoria y en sessionStorage.
  const ui = useMemo(() => ({
    selected, pathIds: pathIds ? [...pathIds] : null, foundId, filters,
  }), [selected, pathIds, foundId, filters]);
  useEffect(() => { if (store) store.ui = { ...store.ui, ...ui }; }, [store, ui]);
  useEffect(() => {
    if (!store) return undefined;
    const save = () => saveTreeState(cacheKey, { tree: store.snapshot(), ui: store.ui });
    const t = setTimeout(save, 400);
    // Si se sale de la vista o se recarga antes del retardo, se guarda igualmente.
    window.addEventListener('pagehide', save);
    return () => { clearTimeout(t); window.removeEventListener('pagehide', save); save(); };
  }, [store, version, ui, cacheKey]);
  const onTransform = useCallback((t) => {
    if (!store) return;
    store.ui = { ...store.ui, t };
    saveTreeState(cacheKey, { tree: store.snapshot(), ui: store.ui });
  }, [store, cacheKey]);

  const locateIn = async (s, personId) => {
    try {
      const chain = await s.locate(personId);
      if (!chain) {
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

  // ---- Expansión jerárquica
  const targetKey = store && selected && store.get(`p${selected}`) ? `p${selected}` : store?.rootKey;
  const targetNode = store && targetKey ? store.get(targetKey) : null;
  const targetName = targetNode ? (targetNode.kind === 'head' ? targetNode.data.name : targetNode.data.full_name) : '';
  const targetHasKids = targetNode && (targetNode.kind === 'head' || targetNode.data.child_count > 0);

  async function runExpandAll(s, key) {
    try {
      await s.expandAll(key);
      setTimeout(() => (key === s.rootKey ? canvas.current?.fit() : canvas.current?.centerOn(key)), 60);
    } catch (e) { toast(e.message, 'error'); }
  }
  const expandLevel = (key) => store.expand(key);
  const collapseAll = (key) => {
    store.collapseBranch(key);
    setTimeout(() => (key === store.rootKey ? canvas.current?.fit() : canvas.current?.centerOn(key)), 30);
  };

  // ---- Filtros (atenúan sin romper la estructura)
  const geoIds = {
    localidad: filters.geo?.localidad?.id, comuna: filters.geo?.comuna?.id, barrio: filters.geo?.barrio?.id,
  };
  const isDimmed = useMemo(() => {
    const { status, from, to, geoPending } = filters;
    if (!status && !from && !to && !geoIds.localidad && !geoPending) return null;
    return (n) => {
      if (n.kind !== 'person') return false;
      const d = n.data;
      if (status && d.status !== status) return true;
      if (from && d.created_at.slice(0, 10) < from) return true;
      if (to && d.created_at.slice(0, 10) > to) return true;
      if (geoIds.localidad && d.geo_localidad_id !== geoIds.localidad) return true;
      if (geoIds.comuna && d.geo_comuna_id !== geoIds.comuna) return true;
      if (geoIds.barrio && d.geo_barrio_id !== geoIds.barrio) return true;
      if (geoPending && d.geo_status !== 'pending') return true;
      return false;
    };
  }, [filters, geoIds.localidad, geoIds.comuna, geoIds.barrio]); // eslint-disable-line react-hooks/exhaustive-deps

  const matchCount = useMemo(() => {
    if (!store || !isDimmed) return null;
    let total = 0; let match = 0;
    for (const n of store.nodes.values()) if (n.kind === 'person') { total++; if (!isDimmed(n)) match++; }
    return { total, match };
  }, [store, version, isDimmed]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeFilters = (filters.status ? 1 : 0) + (filters.from ? 1 : 0) + (filters.to ? 1 : 0)
    + (geoIds.localidad ? 1 : 0) + (filters.geoPending ? 1 : 0);
  const progress = store?.progress;

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
        <div style={{ width: 240, maxWidth: '100%' }}>
          <PersonPicker headId={a.isSuper ? undefined : headId} value={null} onChange={onSearchPick} placeholder="Buscar y localizar…" />
        </div>
        <div style={{ width: 220, maxWidth: '100%' }}>
          <LeaderPicker id="tree-leader" leaders={leaders} compact placeholder="Todos los líderes"
            value={focusNode?.is_leader ? focusNode.id : ''} onChange={(id) => setParams({ foco: id || null, persona: null })} />
        </div>
        <button className={`btn ${activeFilters ? 'btn-primary' : ''}`} onClick={() => setShowFilters((x) => !x)}>
          <Filter size={15} />Filtros{activeFilters ? ` (${activeFilters})` : ''}
        </button>
        <div className="spacer" />
        <div className="seg" role="tablist" aria-label="Vista">
          <button className={view === 'arbol' ? 'active' : ''} onClick={() => setParams({ vista: null })}><Network size={14} />Árbol</button>
          <button className={view === 'lista' ? 'active' : ''} onClick={() => setParams({ vista: 'lista' })}><List size={14} />Lista</button>
        </div>
      </div>
      {store && (
        <div className="tree-bar tree-actions" style={{ paddingTop: 6, paddingBottom: 6 }}>
          <span className="small muted ellipsis" style={{ maxWidth: 260 }} title={targetName}>
            Rama: <b style={{ color: 'var(--text)' }}>{targetName}</b>{selected ? '' : ' (raíz)'}
          </span>
          <button className="btn btn-sm" disabled={!targetHasKids || !!progress} onClick={() => expandLevel(targetKey)}
            title="Abre sólo el siguiente nivel de la rama"><ChevronDown size={14} />Expandir nivel</button>
          <button className="btn btn-sm" disabled={!targetHasKids || !!progress} onClick={() => runExpandAll(store, targetKey)}
            title="Abre recursivamente todos los niveles descendientes"><ChevronsDown size={14} />Expandir todo</button>
          <button className="btn btn-sm" disabled={!!progress} onClick={() => collapseAll(targetKey)}
            title="Cierra todos los niveles descendientes de la rama"><ChevronsUp size={14} />Contraer todo</button>
          <button className="btn btn-sm btn-ghost" disabled={!!progress} onClick={() => refreshStore(store)} title="Actualizar datos sin perder las ramas abiertas">
            <RefreshCw size={14} /><span className="hide-sm">Actualizar</span>
          </button>
          {progress && (
            <span className="row small" role="status" style={{ gap: 8 }}>
              <span className="spinner" />
              Expandiendo «{progress.label}»: {fmtNum(progress.loaded)}{progress.total ? ` de ${fmtNum(progress.total)}` : ''} personas
              {progress.total ? <span className="progress"><div style={{ width: `${Math.min(100, (progress.loaded / Math.max(1, progress.total)) * 100)}%` }} /></span> : null}
              <button className="btn btn-sm btn-ghost" onClick={() => store.cancelLoad()}>Cancelar</button>
            </span>
          )}
        </div>
      )}
      {focusNode && (
        <div className="tree-bar" style={{ paddingTop: 8, paddingBottom: 8, background: 'var(--accent-soft)' }}>
          <GitBranch size={15} />
          <span>Viendo la rama de <b>{focusNode.full_name}</b>{focusNode.is_leader && <Crown size={12} color="var(--leader)" style={{ marginLeft: 4 }} />} · {fmtNum(focusNode.descendant_count)} personas debajo</span>
          <button className="btn btn-sm" onClick={() => setParams({ foco: null })}><X size={14} />Ver árbol completo</button>
        </div>
      )}
      {matchCount && (
        <div className="tree-bar small" style={{ paddingTop: 6, paddingBottom: 6 }}>
          Filtro activo: <b>{fmtNum(matchCount.match)}</b> de {fmtNum(matchCount.total)} personas cargadas coinciden; el resto se atenúa para no romper la estructura.
          Use «Expandir todo» para aplicar el filtro a toda la rama.
          <button className="btn btn-sm btn-ghost" onClick={() => setFilters(emptyFilters)}>Limpiar</button>
        </div>
      )}
      <div className="tree-shell">
        {showFilters && (
          <div className="card card-pad filters-panel stack" style={{ boxShadow: 'var(--shadow-lg)', width: 340 }}>
            <div className="row"><h3>Filtros</h3><span className="spacer" /><button className="btn btn-ghost btn-sm btn-icon" onClick={() => setShowFilters(false)} aria-label="Cerrar"><X size={16} /></button></div>
            <div className="field"><label>Estado</label>
              <select className="select" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
                <option value="">Todos</option><option value="active">Activas</option><option value="pending">Pendientes</option><option value="inactive">Inactivas</option>
              </select>
            </div>
            <div className="grid g-2" style={{ gap: 8 }}>
              <div className="field"><label>Desde</label><input type="date" className="input" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} /></div>
              <div className="field"><label>Hasta</label><input type="date" className="input" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} /></div>
            </div>
            <div className="field"><label className="row" style={{ gap: 6 }}><MapPin size={14} />Ubicación</label>
              <div className="stack" style={{ gap: 8 }}>
                <GeoSelect mode="filter" idPrefix="tf" value={filters.geo} onChange={(geo) => setFilters({ ...filters, geo })} />
              </div>
            </div>
            <label className="check"><input type="checkbox" checked={filters.geoPending} onChange={(e) => setFilters({ ...filters, geoPending: e.target.checked })} />
              <span className="small">Sólo ubicaciones pendientes de verificación</span></label>
            <span className="small muted">Para filtrar por líder use el selector de líderes: el árbol se centra en su rama.</span>
          </div>
        )}
        {error && <div className="page"><ErrorBox error={error} /></div>}
        {!store && !error && <div style={{ flex: 1 }}><Loading /></div>}
        {store && view === 'arbol' && (
          <TreeCanvas ref={canvas} store={store} version={version} selectedId={selected} pathIds={pathIds} foundId={foundId}
            isDimmed={isDimmed} headColor={head.color} onSelect={(n) => setSelected(n.data.id)}
            initialTransform={initialTransform} onTransform={onTransform}
            onExpandAll={(key) => runExpandAll(store, key)} />
        )}
        {store && view === 'lista' && (
          <TreeList store={store} version={version} selectedId={selected} pathIds={pathIds} isDimmed={isDimmed}
            headColor={head.color} scrollToId={scrollToId} onSelect={(n) => setSelected(n.data.id)}
            onExpandAll={(key) => runExpandAll(store, key)} onCollapseAll={(key) => store.collapseBranch(key)} />
        )}
        {selected && (
          <NodePanel personId={selected} headName={head.name} onClose={() => setSelected(null)}
            canRegister={a.canManageHead(headId)}
            onRegisterInvitee={(p) => setRegisterFor({ id: p.id, full_name: p.full_name, head_id: p.head_id, is_leader: p.is_leader, code: p.code, leader_code: p.leader_code, leader_name: null, status: p.status })}
            onFocus={(id) => { setSelected(null); setParams({ foco: id, persona: null }); }}
            onHighlight={highlight}
            onExpandLevel={() => expandLevel(`p${selected}`)}
            onExpandAll={() => runExpandAll(store, `p${selected}`)}
            onCollapseAll={() => collapseAll(`p${selected}`)}
            busy={!!progress} />
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
