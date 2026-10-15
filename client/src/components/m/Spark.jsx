import { useEffect, useRef, useState } from 'react';
import { Mark } from '../../brand/Brand.jsx';
import { initialsOf } from '../../lib/teams.js';

/** Línea mínima de tendencia (64×24) en el color del equipo. */
export function Sparkline({ values, color = 'currentColor', width = 64, height = 24, label }) {
  if (!values || values.length < 2) return null;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * (width - 2) + 1).toFixed(1)},${(height - 2 - ((v - min) / span) * (height - 4)).toFixed(1)}`).join(' ');
  return (
    <svg className="m-spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : 'true'}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const weekday = new Intl.DateTimeFormat('es', { weekday: 'long' });
const dayOf = (iso) => new Date(`${iso}T12:00:00`);

/** Registros de los últimos días en barras; la de hoy en celeste. */
export function DayBars({ days }) {
  if (!days?.length) return null;
  const max = Math.max(1, ...days.map((d) => d.n));
  const label = `Registros por día: ${days.map((d) => `${weekday.format(dayOf(d.day))} ${d.n}`).join(', ')}`;
  return (
    <div className="m-daybars" role="img" aria-label={label}>
      {days.map((d, i) => (
        <span key={d.day} className={`m-daybar ${i === days.length - 1 ? 'is-today' : ''}`}>
          <span className="m-daybar__bar" style={{ '--h': `${Math.max(4, (d.n / max) * 100)}%` }} />
          <span className="m-daybar__day">{weekday.format(dayOf(d.day)).charAt(0)}</span>
        </span>
      ))}
    </div>
  );
}

/** Avatar del equipo: iniciales de la cabeza en un anillo de su color (con la marca dorada) o el ícono de la estructura. */
export function TeamAvatar({ head, size = 44 }) {
  const person = !!head?.cabeza_name;
  return (
    <span className={`m-team-avatar ${person ? '' : 'is-vacant'}`} style={{ '--hc': head?.color || 'var(--sky)', '--s': `${size}px` }} aria-hidden="true">
      {person ? initialsOf(head.cabeza_name) : initialsOf(String(head?.name || '').replace(/^cabeza\s+/i, ''))}
      {person && <Mark className="m-team-avatar__mark" />}
    </span>
  );
}

/** Avatar de una persona: anillo celeste si es líder, dorado si es cabeza. */
export function PersonAvatar({ name, leader, head, size = 40 }) {
  return (
    <span className={`m-avatar ${head ? 'is-head' : leader ? 'is-leader' : ''}`} style={{ '--s': `${size}px` }} aria-hidden="true">
      {initialsOf(name)}
    </span>
  );
}

const dayShort = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' });
const fmtDay = (iso) => dayShort.format(new Date(`${iso}T12:00:00`));
const nf = new Intl.NumberFormat('es');

/**
 * Crecimiento acumulado en una sola línea, para el celular: arriba el número del día que se toca (o el de hoy),
 * se recorre con el dedo de lado a lado sin bloquear el desplazamiento vertical.
 */
export function TrendChart({ points, height = 168, label = 'Crecimiento acumulado' }) {
  const ref = useRef(null);
  const [w, setW] = useState(320);
  const [hover, setHover] = useState(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setW(el.clientWidth || 320));
    ro.observe(el);
    setW(el.clientWidth || 320);
    return () => ro.disconnect();
  }, []);
  if (!points?.length) return null;
  const pad = { l: 4, r: 4, t: 10, b: 6 };
  const iw = Math.max(40, w - pad.l - pad.r);
  const ih = height - pad.t - pad.b;
  const min = Math.min(...points.map((p) => p.value));
  const max = Math.max(...points.map((p) => p.value));
  const lo = Math.max(0, min - (max - min) * 0.1);
  const span = Math.max(1, max - lo);
  const x = (i) => pad.l + (points.length <= 1 ? iw / 2 : (i / (points.length - 1)) * iw);
  const y = (v) => pad.t + ih - ((v - lo) / span) * ih;
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join('');
  const area = `${line}L${x(points.length - 1).toFixed(1)},${pad.t + ih}L${x(0).toFixed(1)},${pad.t + ih}Z`;
  const shown = hover ?? points.length - 1;
  const onMove = (e) => {
    const r = ref.current.getBoundingClientRect();
    const i = Math.round(((e.clientX - r.left - pad.l) / iw) * (points.length - 1));
    setHover(Math.max(0, Math.min(points.length - 1, i)));
  };
  return (
    <div className="m-trend" ref={ref}>
      <div className="m-trend__head" aria-live="polite">
        <b>{nf.format(points[shown].value)}</b>
        <span>{hover === null ? 'hoy' : fmtDay(points[shown].day)}</span>
      </div>
      <svg width={w} height={height} role="img" aria-label={`${label}: de ${nf.format(points[0].value)} el ${fmtDay(points[0].day)} a ${nf.format(points[points.length - 1].value)} hoy`}
        onPointerDown={onMove} onPointerMove={onMove} onPointerLeave={() => setHover(null)} onPointerCancel={() => setHover(null)}>
        <path d={area} className="m-trend__area" />
        <path d={line} className="m-trend__line" />
        {hover !== null && (
          <g>
            <line className="m-trend__cross" x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + ih} />
            <circle className="m-trend__dot" cx={x(hover)} cy={y(points[hover].value)} r={5} />
          </g>
        )}
      </svg>
      <div className="m-trend__axis"><span>{fmtDay(points[0].day)}</span><span>Hoy</span></div>
    </div>
  );
}
