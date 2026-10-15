import { ChevronRight } from 'lucide-react';
import { useGo } from '../../lib/nav.js';

/** Sección con título (y un enlace opcional a la derecha). */
export function Section({ title, action, children, className = '', id }) {
  return (
    <section className={`m-section ${className}`} id={id} aria-label={typeof title === 'string' ? title : undefined}>
      {(title || action) && (
        <div className="m-section__head">
          {title && <h2>{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

/** Grupo de filas con separadores finos. */
export function Group({ children, className = '' }) {
  return <div className={`card list-card m-group ${className}`}>{children}</div>;
}

/**
 * Fila de lista: avatar o ícono, título (hasta dos líneas), detalle, y un número o una hora al final.
 * to: abre otra pantalla de la pestaña; onClick: acción; href: enlace externo (WhatsApp, teléfono).
 */
export function Row({ lead, title, meta, trail, to, onClick, href, linkProps, chevron, className = '', label, children, state }) {
  const go = useGo();
  const inner = (
    <>
      {lead && <span className="m-row__lead">{lead}</span>}
      <span className="m-row__main">
        <span className="m-row__title">{title}</span>
        {meta && <span className="m-row__meta">{meta}</span>}
        {children}
      </span>
      {trail !== undefined && trail !== null && <span className="m-row__trail">{trail}</span>}
      {(chevron ?? !!to) && <ChevronRight className="m-row__chev" size={18} aria-hidden="true" />}
    </>
  );
  const cls = `m-row ${className}`;
  if (href) return <a className={cls} href={href} aria-label={label} {...(linkProps || {})} onClick={onClick}>{inner}</a>;
  if (to || onClick) {
    return (
      <button type="button" className={cls} aria-label={label}
        onClick={(e) => { if (onClick) onClick(e); if (to && !e.defaultPrevented) go(to, { state }); }}>
        {inner}
      </button>
    );
  }
  return <div className={cls} aria-label={label}>{inner}</div>;
}

/** Fila de acción de una sola línea (como en Ajustes): ícono, texto y, a la derecha, un valor. */
export function ActionRow({ icon: Icon, children, value, to, onClick, href, linkProps, danger, chevron = true }) {
  const go = useGo();
  const inner = (
    <>
      {Icon && <Icon size={20} aria-hidden="true" />}
      <span className="list-row__text">{children}</span>
      {value !== undefined && value !== null && <span className="list-row__value">{value}</span>}
      {chevron && (to || href) && <ChevronRight className="m-row__chev" size={18} aria-hidden="true" />}
    </>
  );
  const cls = `list-row ${danger ? 'danger' : ''}`;
  if (href) return <a className={cls} href={href} {...(linkProps || {})} onClick={onClick}>{inner}</a>;
  return <button type="button" className={cls} onClick={(e) => { onClick?.(e); if (to) go(to); }}>{inner}</button>;
}

/** Fichas que bajan de línea (nunca se desplazan de lado). */
export function Chips({ children, label, className = '' }) {
  return <div className={`m-chips ${className}`} role="group" aria-label={label}>{children}</div>;
}

export function Chip({ active, onClick, children, warn, onRemove, removeLabel, icon: Icon, count }) {
  if (onRemove) {
    return (
      <span className="m-chip is-removable">
        <span>{children}</span>
        <button type="button" className="m-chip__x" onClick={onRemove} aria-label={removeLabel || 'Quitar filtro'}>×</button>
      </span>
    );
  }
  return (
    <button type="button" className={`m-chip ${warn ? 'm-chip--warn' : ''}`} aria-pressed={active ? 'true' : 'false'} onClick={onClick}>
      {Icon && <Icon size={15} aria-hidden="true" />}{children}{count !== undefined && <span className="m-chip__count">{count}</span>}
    </button>
  );
}

/** Control segmentado (pestañas de una pantalla). */
export function Segmented({ value, onChange, options, label, sticky }) {
  return (
    <div className={`m-seg ${sticky ? 'is-sticky' : ''}`} role="tablist" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={value === o.value} className={value === o.value ? 'active' : ''}
          onClick={() => onChange(o.value)}>
          {o.label}{o.count !== undefined && <span className="m-seg__count">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** Estado vacío de una lista: dice qué hacer. */
export function EmptyState({ icon: Icon, title, children, action }) {
  return (
    <div className="m-empty">
      {Icon && <span className="m-empty__icon" aria-hidden="true"><Icon size={24} /></span>}
      <b>{title}</b>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

/** Filas grises mientras carga (mismo alto que las reales: no hay saltos). */
export function RowsSkeleton({ rows = 4 }) {
  return (
    <div className="card list-card m-group" aria-busy="true" aria-label="Cargando">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="m-row m-row--skeleton">
          <span className="m-row__lead"><span className="skeleton m-sk-avatar" /></span>
          <span className="m-row__main"><span className="skeleton m-sk-line" /><span className="skeleton m-sk-line short" /></span>
        </div>
      ))}
    </div>
  );
}
