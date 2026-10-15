import { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Maximize2, Minus, Plus, Crosshair } from 'lucide-react';
import { NODE_W, NODE_H } from '../lib/treeStore.js';
import { initials, fmtNum, fmtDate } from '../lib/format.js';
import { CAMPAIGN } from '../brand/Brand.jsx';

const MIN_K = 0.15;
const MAX_K = 2.2;

const trunc = (s, n) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s || '');
const firstNames = (s) => (s ? s.split(' ').slice(0, 2).join(' ') : '');

/**
 * Lienzo SVG del árbol con zoom, desplazamiento, pellizco y culling por viewport:
 * sólo se renderizan los nodos dentro del área visible, de modo que miles de nodos
 * expandidos siguen siendo fluidos.
 */
const TreeCanvas = forwardRef(function TreeCanvas(
  { store, version, selectedId, pathIds, foundId, isDimmed, onSelect, headColor, initialTransform, onTransform, onExpandAll }, ref,
) {
  const wrap = useRef(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [t, setT] = useState(() => initialTransform || { x: 40, y: 40, k: 0.9 });
  // Al cambiar de árbol (cabeza/foco) se recupera la vista guardada de ese árbol.
  const lastStore = useRef(store);
  useEffect(() => {
    if (lastStore.current !== store && initialTransform) setT(initialTransform);
    lastStore.current = store;
  }, [store, initialTransform]);
  // Guarda la vista (con retardo) y, al desmontar, la última sin esperar al retardo.
  const onTransformRef = useRef(onTransform);
  onTransformRef.current = onTransform;
  useEffect(() => {
    if (!onTransform) return undefined;
    const id = setTimeout(() => onTransform(t), 300);
    return () => clearTimeout(id);
  }, [t, onTransform]);
  useEffect(() => {
    const flush = () => onTransformRef.current?.(tRef.current);
    window.addEventListener('pagehide', flush);
    return () => { window.removeEventListener('pagehide', flush); flush(); };
  }, []);
  const tRef = useRef(t);
  tRef.current = t;
  const drag = useRef(null);
  const pointers = useRef(new Map());
  const moved = useRef(false);
  const [dragging, setDragging] = useState(false);

  const layout = useMemo(() => store.layout(), [store, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const posByKey = useMemo(() => new Map(layout.items.map((i) => [i.key, i])), [layout]);

  useEffect(() => {
    const el = wrap.current;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const zoomAt = useCallback((factor, cx, cy) => {
    setT((p) => {
      const k = Math.min(MAX_K, Math.max(MIN_K, p.k * factor));
      const f = k / p.k;
      return { k, x: cx - (cx - p.x) * f, y: cy - (cy - p.y) * f };
    });
  }, []);

  useEffect(() => {
    const el = wrap.current;
    const onWheel = (e) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) > Math.abs(e.deltaX) * 1.2 && !e.shiftKey) {
        zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018)), e.clientX - r.left, e.clientY - r.top);
      } else {
        setT((p) => ({ ...p, x: p.x - e.deltaX, y: p.y - e.deltaY }));
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  const centerOn = useCallback((key, opts = {}) => {
    const it = posByKey.get(key) || store.layout().items.find((i) => i.key === key);
    if (!it) return;
    const el = wrap.current;
    setT((p) => {
      const k = opts.k ?? Math.max(p.k, 0.85);
      return { k, x: el.clientWidth / 2 - (it.x + NODE_W / 2) * k, y: el.clientHeight / 2 - (it.y + it.h / 2) * k };
    });
  }, [posByKey, store]);

  const fit = useCallback(() => {
    const lay = store.layout();
    const b = lay.bounds;
    const el = wrap.current;
    const k = Math.min(MAX_K, Math.min((el.clientWidth - 80) / Math.max(b.w, 1), (el.clientHeight - 80) / Math.max(b.h, 1), 1.1));
    if (k < 0.5) {
      // Estructura demasiado grande para verla entera de forma legible: se centra en la raíz.
      const root = lay.items.find((i) => i.key === store.rootKey);
      const kk = 0.8;
      setT({ k: kk, x: 40, y: el.clientHeight / 2 - (root.y + root.h / 2) * kk });
      return;
    }
    setT({ k, x: (el.clientWidth - b.w * k) / 2, y: (el.clientHeight - b.h * k) / 2 - b.y * k });
  }, [store]);

  useImperativeHandle(ref, () => ({ centerOn, fit }), [centerOn, fit]);

  // ---- arrastre y pellizco
  const onPointerDown = (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved.current = false;
    if (pointers.current.size === 1) drag.current = { sx: e.clientX, sy: e.clientY, x: tRef.current.x, y: tRef.current.y };
    else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      drag.current = { pinch: Math.hypot(a.x - b.x, a.y - b.y), k: tRef.current.k };
    }
  };
  const onPointerMove = (e) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const d = drag.current;
    if (!d) return;
    if (pointers.current.size === 2 && d.pinch) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const r = wrap.current.getBoundingClientRect();
      const target = Math.min(MAX_K, Math.max(MIN_K, d.k * (dist / d.pinch)));
      zoomAt(target / tRef.current.k, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
      moved.current = true;
      return;
    }
    const dx = e.clientX - d.sx; const dy = e.clientY - d.sy;
    if (!moved.current && Math.hypot(dx, dy) > 4) {
      moved.current = true;
      setDragging(true);
      wrap.current.setPointerCapture?.(e.pointerId);
    }
    if (moved.current) setT((p) => ({ ...p, x: d.x + dx, y: d.y + dy }));
  };
  const onPointerUp = (e) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) { drag.current = null; setDragging(false); }
    else if (pointers.current.size === 1) {
      const [p] = [...pointers.current.values()];
      drag.current = { sx: p.x, sy: p.y, x: tRef.current.x, y: tRef.current.y };
    }
  };
  const click = (fn) => (e) => { e.stopPropagation(); if (!moved.current) fn(e); };

  // ---- culling
  const margin = 200;
  const vx0 = (-t.x - margin) / t.k; const vy0 = (-t.y - margin) / t.k;
  const vx1 = (size.w - t.x + margin) / t.k; const vy1 = (size.h - t.y + margin) / t.k;
  const inView = (it) => it.x + NODE_W >= vx0 && it.x <= vx1 && it.y + it.h >= vy0 && it.y <= vy1;
  const visibleItems = layout.items.filter(inView);
  const visibleEdges = layout.edges.filter((e) => inView(e.from) || inView(e.to)
    || (Math.min(e.from.y, e.to.y) <= vy1 && Math.max(e.from.y, e.to.y) >= vy0 && e.from.x <= vx1 && e.to.x >= vx0));
  // En la red, John (la raíz) también es parte del camino resaltado: de él cuelga la cabeza de esa persona.
  const onPath = (key) => !!pathIds && ((store.network && key === store.rootKey) || (key.startsWith('p') && pathIds.has(Number(key.slice(1)))));
  const detail = t.k >= 0.45; // a poco zoom se simplifican los nodos

  return (
    <div ref={wrap} className={`tree-canvas ${dragging ? 'dragging' : ''}`}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
      <svg role="tree" aria-label={store.network ? `Red de ${CAMPAIGN}` : 'Árbol de la estructura'}>
        <g transform={`translate(${t.x},${t.y}) scale(${t.k})`}>
          {visibleEdges.map((e) => {
            const x1 = e.from.x + NODE_W; const y1 = e.from.y + e.from.h / 2;
            const x2 = e.to.x; const y2 = e.to.y + e.to.h / 2;
            const mx = (x1 + x2) / 2;
            const hl = onPath(e.from.key) && onPath(e.to.key);
            const dim = e.to.node && isDimmed?.(e.to.node);
            return <path key={`${e.from.key}-${e.to.key}`} className={`edge ${hl ? 'onpath' : ''} ${dim ? 'dim' : ''}`}
              d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`} />;
          })}
          {visibleItems.map((it) => {
            if (it.kind === 'more') {
              return (
                <g key={it.key} className="more-node" transform={`translate(${it.x},${it.y})`}
                  onClick={click(() => store.loadChildren(it.parent, { append: true }))} role="button" aria-label={`Cargar ${it.remaining} más`}>
                  <rect width={NODE_W} height={it.h} rx={8} />
                  <text x={NODE_W / 2} y={it.h / 2 + 4} textAnchor="middle">+ Cargar {fmtNum(Math.min(it.remaining, 50))} de {fmtNum(it.remaining)} restantes</text>
                </g>
              );
            }
            const n = it.node;
            if (it.kind === 'network') return <NetworkNode key={it.key} it={it} n={n} detail={detail} onToggle={click(() => store.toggle(it.key))} />;
            if (it.kind === 'head') return <HeadNode key={it.key} it={it} n={n} color={n.data.color || headColor} detail={detail} onToggle={click(() => store.toggle(it.key))} />;
            const d = n.data;
            const cls = ['node-card', d.is_head ? 'headp' : d.is_leader ? 'leader' : '', d.status === 'pending' ? 'pending' : '', d.status === 'inactive' ? 'inactive' : '',
              selectedId === d.id ? 'selected' : '', onPath(it.key) ? 'onpath' : '', foundId === d.id ? 'found' : '', isDimmed?.(n) ? 'dim' : ''].join(' ');
            const hasKids = d.child_count > 0;
            return (
              <g key={it.key} className={cls} transform={`translate(${it.x},${it.y})`} onClick={click(() => onSelect?.(n))}
                tabIndex={0} role="treeitem" aria-expanded={hasKids ? !!n.expanded : undefined}
                aria-label={`${d.full_name}${d.is_head ? ', cabeza' : d.is_leader ? ', líder' : ''}, ${d.descendant_count} personas debajo`}
                onKeyDown={(e) => { if (e.key === 'Enter') onSelect?.(n); if (e.key === ' ' && hasKids) { e.preventDefault(); store.toggle(it.key); } }}>
                <rect className="bg" width={NODE_W} height={NODE_H} rx={10} />
                <rect x={0} y={8} width={3.5} height={NODE_H - 16} rx={1.75} fill={d.is_head ? 'var(--sky)' : d.is_leader ? 'var(--leader)' : 'var(--axis)'} />
                <circle cx={30} cy={NODE_H / 2} r={17} fill={d.is_head ? 'rgba(96,182,232,0.2)' : d.is_leader ? 'var(--leader-soft)' : 'var(--surface-2)'}
                  stroke={d.is_head ? 'var(--sky)' : d.is_leader ? 'var(--leader)' : 'none'} strokeWidth={1.5} />
                <text x={30} y={NODE_H / 2 + 4.5} textAnchor="middle" fontSize={12} fontWeight={650} fill={d.is_head ? '#fff' : d.is_leader ? 'var(--leader)' : 'var(--text-2)'}>{initials(d.full_name)}</text>
                {d.is_head ? (
                  <g transform={`translate(34,${NODE_H / 2 - 26})`}>
                    <circle r={9} cx={8} cy={8} fill="var(--sky)" />
                    <g transform="translate(3.2,3.2) scale(0.072)"><path d="M44 0H134V90H110V24H44Z" fill="#05204a" /><path d="M0 46H90V136H66V70H0Z" fill="#05204a" opacity="0.6" /></g>
                  </g>
                ) : d.is_leader && (
                  <g transform={`translate(38,${NODE_H / 2 - 22})`}>
                    <circle r={8} cx={4} cy={4} fill="var(--leader)" />
                    <path d="M0.5 6.5 L1 1.8 L3 3.6 L4 1 L5 3.6 L7 1.8 L7.5 6.5 Z" fill="#fff" />
                  </g>
                )}
                <text className="node-name" x={56} y={detail ? 22 : 37}>{trunc(d.full_name, detail ? 24 : 18)}</text>
                {detail && (
                  <>
                    <text className="node-sub" x={56} y={39}>
                      {d.is_head ? 'Cabeza de la estructura' : d.is_leader ? trunc(d.leader_code, 26) : (d.leader_name ? `Líder: ${trunc(firstNames(d.leader_name), 20)}` : 'Sin líder asignado')}
                    </text>
                    <text className="node-sub" x={56} y={54}>
                      {d.status === 'pending' ? 'Pendiente de aprobación' : d.status === 'inactive' ? 'Inactiva' : `${fmtDate(d.created_at)} · ${d.registration_method === 'manual' ? 'manual' : 'enlace'}`}
                    </text>
                  </>
                )}
                {!hasKids && (
                  <g transform={`translate(${NODE_W},${NODE_H / 2})`} aria-hidden="true">
                    <circle className="node-leaf-dot" r={4} />
                    <title>Sin personas debajo</title>
                  </g>
                )}
                {hasKids && onExpandAll && detail && (
                  <g className="node-toggle" transform={`translate(${NODE_W + Math.max(34, String(d.descendant_count).length * 7 + 22) + 4},${NODE_H / 2})`}
                    onClick={click(() => onExpandAll(it.key))} role="button" aria-label="Expandir todos los niveles de esta rama">
                    <title>Expandir todo (todos los niveles)</title>
                    <circle r={12} cx={10} />
                    <path transform="translate(4,-6)" d="M2 2l4 4 4-4M2 7l4 4 4-4" fill="none" stroke="var(--text-2)" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
                  </g>
                )}
                {hasKids && (
                  <g className="node-toggle" transform={`translate(${NODE_W - 2},${NODE_H / 2})`} onClick={click(() => store.toggle(it.key))}
                    role="button" aria-label={n.expanded ? 'Contraer rama' : 'Expandir un nivel'}>
                    <title>{n.expanded ? 'Contraer esta rama' : 'Expandir el siguiente nivel'}</title>
                    <rect x={-2} y={-12} width={Math.max(34, String(d.descendant_count).length * 7 + 22)} height={24} rx={12}
                      fill={n.expanded ? 'var(--accent-soft)' : 'var(--surface)'} stroke={n.expanded ? 'var(--accent)' : 'var(--border-strong)'} strokeWidth={1.5} />
                    <text x={Math.max(34, String(d.descendant_count).length * 7 + 22) / 2 - 2} y={4} textAnchor="middle"
                      fill={n.expanded ? 'var(--accent)' : 'var(--text-2)'} fontSize={11} fontWeight={700}>
                      {n.loading ? '…' : `${n.expanded ? '−' : '+'}${fmtNum(d.descendant_count)}`}
                    </text>
                  </g>
                )}
              </g>
            );
          })}
        </g>
      </svg>
      <div className="tree-toolbar" onPointerDown={(e) => e.stopPropagation()}>
        <button className="btn btn-sm btn-icon btn-ghost" onClick={() => zoomAt(1.2, size.w / 2, size.h / 2)} aria-label="Acercar" title="Acercar"><Plus size={16} /></button>
        <div className="tree-zoom tnum">{Math.round(t.k * 100)}%</div>
        <button className="btn btn-sm btn-icon btn-ghost" onClick={() => zoomAt(1 / 1.2, size.w / 2, size.h / 2)} aria-label="Alejar" title="Alejar"><Minus size={16} /></button>
        <button className="btn btn-sm btn-icon btn-ghost" onClick={fit} aria-label="Ajustar a la pantalla" title="Ajustar a la pantalla"><Maximize2 size={15} /></button>
        <button className="btn btn-sm btn-icon btn-ghost" onClick={() => centerOn(selectedId ? `p${selectedId}` : store.rootKey)} aria-label="Centrar" title="Centrar en selección"><Crosshair size={15} /></button>
      </div>
      <div className="tree-legend" onPointerDown={(e) => e.stopPropagation()}>
        {store.network
          ? <span><span className="legend-swatch legend-john" />{CAMPAIGN}</span>
          : <span><span className="legend-swatch" style={{ borderColor: headColor, background: 'var(--surface)' }} />Estructura</span>}
        <span><span className="legend-swatch" style={{ borderColor: 'var(--sky)', background: 'var(--navy)' }} />Cabeza</span>
        <span><span className="legend-swatch" style={{ borderColor: 'var(--leader)', background: 'var(--leader-soft)' }} />Líder</span>
        <span><span className="legend-swatch" style={{ borderColor: 'var(--border-strong)' }} />Persona</span>
        <span><span className="legend-swatch" style={{ borderColor: 'var(--warning)', borderStyle: 'dashed' }} />Pendiente</span>
        <span><svg width="10" height="10" aria-hidden="true"><circle cx="5" cy="5" r="4" className="node-leaf-dot" /></svg>Sin invitados</span>
        <span className="muted">Línea = invitó a · {fmtNum(visibleItems.length)}/{fmtNum(layout.items.length)} nodos dibujados</span>
      </div>
    </div>
  );
});

/** John Thowinsson, la raíz de la red: con su foto, y de él cuelgan todas sus cabezas. */
function NetworkNode({ it, n, detail, onToggle }) {
  const d = n.data;
  const clip = `john-${useId().replace(/[^\w-]/g, '')}`;
  const cy = it.h / 2;
  const heads = d.heads ?? null;
  return (
    <g className="node-card node-john" transform={`translate(${it.x},${it.y})`} role="treeitem" aria-expanded={!!n.expanded} onClick={onToggle}
      aria-label={`${CAMPAIGN}${heads != null ? `: ${heads} ${heads === 1 ? 'cabeza' : 'cabezas'}, ${d.people} personas en la red` : ''}`}>
      <rect className="bg" width={NODE_W} height={it.h} rx={16} />
      <clipPath id={clip}><circle cx={42} cy={cy} r={27} /></clipPath>
      <circle className="john-ring" cx={42} cy={cy} r={29.5} />
      <image href="/brand/john-face-160.webp" x={15} y={cy - 27} width={54} height={54} clipPath={`url(#${clip})`} preserveAspectRatio="xMidYMid slice" />
      <text className="node-name john-name" x={82} y={detail ? 36 : cy + 5}>{CAMPAIGN}</text>
      {detail && heads != null && (
        <>
          <text className="node-sub" x={82} y={55}>{fmtNum(heads)} {heads === 1 ? 'cabeza' : 'cabezas'}</text>
          <text className="node-sub" x={82} y={71}>{fmtNum(d.people)} {d.people === 1 ? 'persona' : 'personas'} en la red</text>
        </>
      )}
      <g className="node-toggle" transform={`translate(${NODE_W - 2},${cy})`} onClick={onToggle} role="button" aria-label={n.expanded ? 'Contraer' : 'Ver sus cabezas'}>
        <title>{n.expanded ? 'Contraer' : 'Ver sus cabezas'}</title>
        <rect x={-2} y={-12} width={30} height={24} rx={12} className="john-toggle" />
        <text x={13} y={4} textAnchor="middle" fontSize={12} fontWeight={700}>{n.loading ? '…' : n.expanded ? '−' : '+'}</text>
      </g>
    </g>
  );
}

function HeadNode({ it, n, color, detail, onToggle }) {
  const d = n.data;
  return (
    <g className="node-card" transform={`translate(${it.x},${it.y})`}>
      <rect className="bg" width={NODE_W} height={it.h} rx={12} style={{ stroke: color, strokeWidth: 2 }} />
      <rect width={NODE_W} height={it.h} rx={12} fill={color} opacity={0.1} />
      <circle cx={32} cy={it.h / 2} r={19} fill={color} />
      <g transform={`translate(20,${it.h / 2 - 12})`} stroke="#fff" fill="#fff" strokeLinecap="round">
        <path d="M12 6v6M12 12l-7 7M12 12l7 7M12 12v7" strokeWidth={2} fill="none" />
        <circle cx={12} cy={5} r={3} stroke="none" /><circle cx={5} cy={19} r={2.6} stroke="none" /><circle cx={12} cy={19} r={2.6} stroke="none" /><circle cx={19} cy={19} r={2.6} stroke="none" />
      </g>
      <text className="node-name" x={60} y={detail ? 30 : 42} fontSize={15}>{trunc(d.cabeza_name ? `Equipo de ${d.cabeza_name}` : d.name, 22)}</text>
      {detail && <text className="node-sub" x={60} y={50}>{d.cabeza_name ? 'Estructura' : 'Estructura sin cabeza'}{d.people != null ? ` · ${fmtNum(d.people)} ${d.people === 1 ? 'persona' : 'personas'}` : ''}</text>}
      <g className="node-toggle" transform={`translate(${NODE_W - 2},${it.h / 2})`} onClick={onToggle} role="button" aria-label={n.expanded ? 'Contraer' : 'Expandir'}>
        <rect x={-2} y={-12} width={30} height={24} rx={12} fill={n.expanded ? color : 'var(--surface)'} stroke={color} />
        <text x={13} y={4} textAnchor="middle" fontSize={12} fontWeight={700} fill={n.expanded ? '#fff' : color}>{n.loading ? '…' : n.expanded ? '−' : '+'}</text>
      </g>
    </g>
  );
}

export default TreeCanvas;
