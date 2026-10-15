import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, ChevronsDown, ChevronsUp, Crown, Network } from 'lucide-react';
import { Mark } from '../brand/Brand.jsx';
import { fmtDate, fmtNum } from '../lib/format.js';
import { StatusBadge } from './ui.jsx';

const ROW = 44;
const INDENT = 22;

/** Lista jerárquica virtualizada: sólo se pintan las filas visibles. */
export default function TreeList({ store, version, selectedId, pathIds, isDimmed, onSelect, headColor, scrollToId, onExpandAll, onCollapseAll }) {
  const ref = useRef(null);
  const [scroll, setScroll] = useState({ top: 0, h: 600 });
  const rows = useMemo(() => store.flatten(), [store, version]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = ref.current;
    const upd = () => setScroll({ top: el.scrollTop, h: el.clientHeight });
    upd();
    el.addEventListener('scroll', upd, { passive: true });
    const ro = new ResizeObserver(upd); ro.observe(el);
    return () => { el.removeEventListener('scroll', upd); ro.disconnect(); };
  }, []);

  useEffect(() => {
    if (!scrollToId) return;
    const i = rows.findIndex((r) => r.node.kind === 'person' && r.node.data.id === scrollToId);
    if (i >= 0) ref.current.scrollTo({ top: Math.max(0, i * ROW - ref.current.clientHeight / 2), behavior: 'smooth' });
  }, [scrollToId, rows]);

  const first = Math.max(0, Math.floor(scroll.top / ROW) - 10);
  const last = Math.min(rows.length, Math.ceil((scroll.top + scroll.h) / ROW) + 10);

  return (
    <div className="tlist" ref={ref} role="tree" aria-label="Lista jerárquica">
      <div style={{ height: rows.length * ROW, position: 'relative' }}>
        {rows.slice(first, last).map(({ node: n, depth }, idx) => {
          const i = first + idx;
          const style = { top: i * ROW, paddingLeft: 12 + depth * INDENT };
          const guides = Array.from({ length: depth }, (_, g) => <span key={g} className="guide" style={{ left: 24 + g * INDENT }} />);
          if (n.kind === 'more') {
            const rem = store.remaining(n.parent);
            return (
              <div key={n.key} className="trow" style={style} onClick={() => store.loadChildren(n.parent, { append: true })}>
                {guides}<span style={{ width: 24 }} />
                <span style={{ color: 'var(--accent)', fontWeight: 600 }}>+ Cargar {fmtNum(Math.min(50, rem))} de {fmtNum(rem)} restantes</span>
              </div>
            );
          }
          if (n.kind === 'head') {
            return (
              <div key={n.key} className="trow" style={{ ...style, fontWeight: 650 }} onClick={() => store.toggle(n.key)}>
                <button className="twisty" aria-label="Expandir">{n.expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</button>
                <span className="dot" style={{ background: headColor, width: 12, height: 12 }} />
                <Network size={15} />{n.data.cabeza_name ? `Equipo de ${n.data.cabeza_name}` : n.data.name}
                <span className="muted small" style={{ fontWeight: 400 }}>{n.data.people != null ? `${fmtNum(n.data.people)} personas` : ''}</span>
              </div>
            );
          }
          const d = n.data;
          const hasKids = d.child_count > 0;
          const onPath = pathIds?.has(d.id);
          return (
            <div key={n.key} role="treeitem" aria-level={depth + 1} aria-expanded={hasKids ? !!n.expanded : undefined}
              className={`trow ${selectedId === d.id ? 'selected' : ''}`} style={{ ...style, opacity: isDimmed?.(n) ? 0.35 : 1 }}
              onClick={() => onSelect(n)}>
              {guides}
              {hasKids
                ? <button className="twisty" onClick={(e) => { e.stopPropagation(); store.toggle(n.key); }} aria-label={n.expanded ? 'Contraer' : 'Expandir'}>
                  {n.loading ? <span className="spinner" style={{ width: 12, height: 12 }} /> : n.expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                </button>
                : <span style={{ width: 24, flex: 'none', display: 'grid', placeItems: 'center' }} title="Sin personas debajo"><span className="leaf-dot" /></span>}
              {d.is_head ? <Mark size={13} className="role-icon" /> : d.is_leader && <Crown size={14} color="var(--leader)" style={{ flex: 'none' }} />}
              <span className="ellipsis" style={{ fontWeight: d.is_leader || onPath ? 650 : 500, color: onPath ? 'var(--accent)' : undefined, minWidth: 0 }}>{d.full_name}</span>
              {d.is_head ? <span className="badge badge-head hide-sm">Cabeza</span> : d.is_leader
                ? <span className="badge badge-leader hide-sm">{d.leader_code}</span>
                : d.leader_name && <span className="small muted ellipsis hide-sm">Líder: {d.leader_name}</span>}
              <span className="spacer" />
              {d.status !== 'active' && <StatusBadge status={d.status} />}
              <span className="small muted nowrap hide-sm">{fmtDate(d.created_at)}</span>
              {hasKids && onExpandAll && (
                <span className="row-actions">
                  <button className="btn btn-sm btn-ghost btn-icon" title="Expandir todo (todos los niveles)" aria-label={`Expandir todo bajo ${d.full_name}`}
                    onClick={(e) => { e.stopPropagation(); onExpandAll(n.key); }}><ChevronsDown size={14} /></button>
                  <button className="btn btn-sm btn-ghost btn-icon" title="Contraer toda la rama" aria-label={`Contraer la rama de ${d.full_name}`}
                    onClick={(e) => { e.stopPropagation(); onCollapseAll(n.key); }}><ChevronsUp size={14} /></button>
                </span>
              )}
              <span className="badge tnum" title="Personas debajo en la rama">{fmtNum(d.descendant_count)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
