import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, PenLine, Search, X } from 'lucide-react';

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/**
 * Selector con búsqueda (combobox accesible).
 * - options: [{ id, name, alias?, kind? }]
 * - value: opción seleccionada, { manual: 'texto' } o null
 * - manualLabel: si se indica, añade al final la opción para escribir un valor que no está en la lista.
 */
export default function Combobox({
  label, options = [], value, onChange, placeholder = 'Buscar…', disabled, loading, manualLabel, manualPlaceholder,
  error, hint, required, clearable = true, describe, id: idProp, compact,
}) {
  const autoId = useId();
  const id = idProp || autoId;
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const [hl, setHl] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const manual = value && value.manual !== undefined;

  const filtered = useMemo(() => {
    const t = norm(term);
    // sectors: otros nombres con que se busca una opción (una localidad por sus barrios y corregimientos conocidos).
    const list = t ? options.filter((o) => norm(`${o.name} ${o.alias || ''} ${o.sectors || ''}`).includes(t)) : options;
    return list;
  }, [options, term]);
  const items = manualLabel ? [...filtered, { id: '__manual', manual: true }] : filtered;

  useEffect(() => { setHl(0); }, [term, open]);
  useEffect(() => {
    if (!open || !listRef.current) return;
    listRef.current.querySelector(`[data-index="${hl}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [hl, open]);

  const choose = (item) => {
    if (item.manual) onChange({ manual: term.trim() });
    else onChange(item);
    setTerm('');
    setOpen(false);
  };

  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHl((h) => Math.min(h + 1, items.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHl((h) => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter') { if (open && items[hl]) { e.preventDefault(); choose(items[hl]); } }
    else if (e.key === 'Escape') { setOpen(false); }
  };

  const describedBy = [error && `${id}-err`, hint && `${id}-hint`].filter(Boolean).join(' ') || undefined;

  if (manual) {
    return (
      <div className="field">
        {label && <label htmlFor={id}>{label}{required && <span className="req"> *</span>}</label>}
        <div className="combo-manual">
          <PenLine size={15} className="muted" />
          <input id={id} className={`input ${error ? 'invalid' : ''}`} value={value.manual} autoFocus={!value.manual}
            placeholder={manualPlaceholder || 'Escriba el nombre'} maxLength={120} disabled={disabled}
            aria-describedby={describedBy} onChange={(e) => onChange({ manual: e.target.value })} />
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => onChange(null)} disabled={disabled} title="Volver a elegir del listado">Listado</button>
        </div>
        <span className="hint" id={`${id}-hint`}>Se guardará como ubicación <b>pendiente de verificación</b>.</span>
        {error && <span className="err" id={`${id}-err`}>{error}</span>}
      </div>
    );
  }

  return (
    <div className="field">
      {label && <label htmlFor={id}>{label}{required && <span className="req"> *</span>}</label>}
      <div className={`combo ${open ? 'open' : ''} ${compact ? 'compact' : ''}`}>
        <Search size={15} className="combo-icon" />
        <input
          id={id} ref={inputRef} role="combobox" aria-expanded={open} aria-controls={`${id}-list`} aria-autocomplete="list"
          aria-activedescendant={open && items[hl] ? `${id}-opt-${hl}` : undefined} aria-describedby={describedBy}
          className={`input ${error ? 'invalid' : ''}`} disabled={disabled} autoComplete="off"
          placeholder={value ? '' : loading ? 'Cargando…' : placeholder}
          value={open ? term : value ? '' : ''}
          onChange={(e) => { setTerm(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} onKeyDown={onKey}
        />
        {value && !open && (
          <button type="button" className="combo-value" onClick={() => { setOpen(true); inputRef.current?.focus(); }} disabled={disabled} tabIndex={-1}>
            <span className="ellipsis">{value.name}{value.alias && !compact ? <span className="muted"> · {value.alias}</span> : null}</span>
          </button>
        )}
        {value && clearable && !disabled
          ? <button type="button" className="combo-btn" aria-label={`Quitar ${label || 'selección'}`} onClick={() => onChange(null)}><X size={15} /></button>
          : <span className="combo-btn" aria-hidden="true"><ChevronDown size={15} /></span>}
        {open && !disabled && (
          <ul className="dropdown combo-list" id={`${id}-list`} role="listbox" ref={listRef}>
            {loading && <li className="dropdown-item muted">Cargando…</li>}
            {!loading && filtered.length === 0 && <li className="dropdown-item muted">Sin coincidencias{term ? ` para «${term}»` : ''}</li>}
            {items.map((o, i) => (
              <li key={o.id} id={`${id}-opt-${i}`} data-index={i} role="option" aria-selected={!o.manual && value?.id === o.id}
                className={`dropdown-item ${i === hl ? 'hl' : ''} ${o.manual ? 'combo-manual-opt' : ''}`}
                onMouseDown={(e) => { e.preventDefault(); choose(o); }} onMouseEnter={() => setHl(i)}>
                {o.manual ? (
                  <><PenLine size={15} /><span>{manualLabel}{term ? <span className="muted"> («{term}»)</span> : null}</span></>
                ) : (
                  <>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span className="ellipsis" style={{ display: 'block' }}>{o.name}</span>
                      {(o.alias || describe) && <span className="small muted ellipsis" style={{ display: 'block' }}>{describe ? describe(o) : o.alias}</span>}
                    </span>
                    {value?.id === o.id && <Check size={15} color="var(--accent)" />}
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      {hint && <span className="hint" id={`${id}-hint`}>{hint}</span>}
      {error && <span className="err" id={`${id}-err`}>{error}</span>}
    </div>
  );
}
