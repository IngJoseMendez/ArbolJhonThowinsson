import { useEffect, useMemo, useRef, useState } from 'react';
import { fmtNum } from '../lib/format.js';

function useWidth(ref) {
  const [w, setW] = useState(600);
  useEffect(() => {
    const ro = new ResizeObserver(() => setW(ref.current?.clientWidth || 600));
    ro.observe(ref.current);
    setW(ref.current.clientWidth);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

function niceTicks(max, count = 4) {
  if (max <= 0) return [0, 1];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
  const ticks = [];
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(Math.round(v * 100) / 100);
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

const dayFmt = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' });
const fmtDay = (d) => dayFmt.format(new Date(`${d}T12:00:00Z`));

/** Crecimiento acumulado por cabeza (líneas, un solo eje, crosshair + tooltip). */
export function GrowthChart({ heads, series, height = 260 }) {
  const ref = useRef(null);
  const w = useWidth(ref);
  const [hover, setHover] = useState(null);
  const pad = { l: 44, r: heads.length <= 4 ? 110 : 16, t: 12, b: 28 };
  const iw = Math.max(50, w - pad.l - pad.r);
  const ih = height - pad.t - pad.b;
  const max = useMemo(() => Math.max(1, ...series.flatMap((s) => heads.map((h) => s.values[h.id] || 0))), [series, heads]);
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1];
  const x = (i) => pad.l + (series.length <= 1 ? iw / 2 : (i / (series.length - 1)) * iw);
  const y = (v) => pad.t + ih - (v / top) * ih;
  const xTicks = series.length ? [0, Math.floor(series.length / 3), Math.floor((2 * series.length) / 3), series.length - 1] : [];

  const onMove = (e) => {
    const r = ref.current.getBoundingClientRect();
    const px = e.clientX - r.left;
    const i = Math.round(((px - pad.l) / iw) * (series.length - 1));
    setHover(Math.max(0, Math.min(series.length - 1, i)));
  };

  const last = series[series.length - 1];
  // Etiquetas directas al final de cada línea, separadas para no solaparse.
  const endLabels = heads.length <= 4 && last ? (() => {
    const ls = heads.map((h) => ({ h, y: y(last.values[h.id] || 0) })).sort((a, b) => a.y - b.y);
    for (let i = 1; i < ls.length; i++) if (ls[i].y - ls[i - 1].y < 14) ls[i].y = ls[i - 1].y + 14;
    return ls;
  })() : [];

  return (
    <div className="chart" ref={ref}>
      <div className="legend" style={{ marginBottom: 8 }}>
        {heads.map((h) => <span key={h.id}><i style={{ background: h.color }} />{h.name}</span>)}
      </div>
      <svg height={height} onPointerMove={onMove} onPointerLeave={() => setHover(null)} role="img"
        aria-label="Crecimiento acumulado de personas registradas por cabeza">
        {ticks.map((t) => (
          <g key={t}>
            <line className={t === 0 ? 'baseline' : 'gridline'} x1={pad.l} x2={pad.l + iw} y1={y(t)} y2={y(t)} />
            <text className="tick" x={pad.l - 8} y={y(t) + 4} textAnchor="end">{fmtNum(t)}</text>
          </g>
        ))}
        {xTicks.map((i, k) => series[i] && (
          <text key={k} className="tick" x={x(i)} y={height - 8} textAnchor={k === 0 ? 'start' : k === xTicks.length - 1 ? 'end' : 'middle'}>{fmtDay(series[i].day)}</text>
        ))}
        {heads.map((h) => (
          <path key={h.id} fill="none" stroke={h.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"
            d={series.map((s, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(s.values[h.id] || 0).toFixed(1)}`).join('')} />
        ))}
        {endLabels.map(({ h, y: ly }) => (
          <text key={h.id} x={pad.l + iw + 8} y={ly + 4} fontSize={11.5} fill="var(--text-2)">{h.name.length > 14 ? `${h.name.slice(0, 13)}…` : h.name}</text>
        ))}
        {hover != null && series[hover] && (
          <g>
            <line className="crosshair" x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + ih} />
            {heads.map((h) => (
              <circle key={h.id} cx={x(hover)} cy={y(series[hover].values[h.id] || 0)} r={4.5} fill={h.color} stroke="var(--surface)" strokeWidth={2} />
            ))}
          </g>
        )}
      </svg>
      {hover != null && series[hover] && (
        <div className="tooltip" style={{ left: Math.min(x(hover) + 12, w - 190), top: 30 }}>
          <div className="t-title">{fmtDay(series[hover].day)}</div>
          {heads.map((h) => (
            <div className="t-row" key={h.id}><span className="dot" style={{ background: h.color }} />{h.name}<b>{fmtNum(series[hover].values[h.id] || 0)}</b></div>
          ))}
          <div className="t-row" style={{ marginTop: 4 }}>Nuevos registros ese día<b>{fmtNum(series[hover].new)}</b></div>
        </div>
      )}
    </div>
  );
}

/** Barras horizontales con etiqueta y valor directos (magnitud por categoría). */
export function BarList({ items, color = 'var(--series-1)', onClick, valueLabel = 'personas' }) {
  const [hover, setHover] = useState(null);
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="barlist">
      {items.map((it, i) => (
        <div key={it.key ?? i} className="barlist-row" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
          style={{ cursor: onClick ? 'pointer' : 'default' }} onClick={() => onClick?.(it)}>
          <div className="lbl">{it.dot && <span className="dot" style={{ background: it.dot }} />}<span className="ellipsis" title={it.label}>{it.label}</span></div>
          <div className="bar-track"><div className="bar" style={{ width: `${(it.value / max) * 100}%`, background: it.color || color }} /></div>
          <div className="tnum" style={{ fontWeight: 600, minWidth: 40, textAlign: 'right' }}>{fmtNum(it.value)}</div>
          {hover === i && it.tip && (
            <div className="tooltip" style={{ left: '34%', top: -6, transform: 'translateY(-100%)' }}>
              <div className="t-title">{it.label}</div>
              {it.tip.map(([k, v]) => <div className="t-row" key={k}>{k}<b>{v}</b></div>)}
              <div className="t-row">{valueLabel}<b>{fmtNum(it.value)}</b></div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
