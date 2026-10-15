import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { haptic, prefersReducedMotion } from '../../lib/device.js';

// Hojas que suben desde abajo, como en las apps de iPhone y Android.
// - «Atrás» de Android (y el gesto de iPhone) cierra la hoja abierta, no la pantalla: cada hoja ocupa una entrada
//   del historial mientras está abierta. Si al cerrar una se abre otra, la entrada pasa a la nueva.
// - Se cierra tocando fuera, con Esc o arrastrándola hacia abajo. El foco queda dentro y vuelve a donde estaba.

const sheets = []; // hojas abiertas, la última arriba: { id, requestClose }
let armed = false; // hay una entrada del historial para las hojas
let backTimer = null;

const setInert = (on) => {
  const root = document.getElementById('root');
  if (root) root.inert = on;
  document.documentElement.classList.toggle('m-sheet-open', on);
};

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    if (!armed) return;
    armed = false;
    sheets[sheets.length - 1]?.requestClose('back');
  });
}

// La entrada de la hoja ocupa su propia posición (idx + 1): si se navega desde la hoja (reemplazando su entrada), la
// pantalla nueva queda en la posición correcta y «atrás» y las pestañas siguen sabiendo dónde están.
const pushSheetEntry = () => {
  const st = window.history.state || {};
  window.history.pushState({ ...st, idx: (st.idx ?? 0) + 1, mSheet: 1 }, '');
};

function registerSheet(entry) {
  sheets.push(entry);
  setInert(true);
  if (backTimer) { clearTimeout(backTimer); backTimer = null; } // se reutiliza la entrada de la hoja que se acaba de cerrar
  else if (!armed) { pushSheetEntry(); armed = true; }
  return () => {
    const i = sheets.indexOf(entry);
    if (i >= 0) sheets.splice(i, 1);
    if (sheets.length) {
      // Se cerró una hoja con «atrás» y queda otra abierta debajo: vuelve a tener su entrada.
      if (!armed) { pushSheetEntry(); armed = true; }
      return;
    }
    setInert(false);
    if (armed) {
      backTimer = setTimeout(() => {
        backTimer = null;
        if (!armed) return;
        armed = false;
        if (window.history.state?.mSheet) window.history.back();
      }, 0);
    }
  };
}

/** ¿Estamos dentro de una hoja abierta? (para navegar reemplazando su entrada del historial). */
export const sheetIsOpen = () => sheets.length > 0;

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Hoja inferior. Se monta abierta; para cerrarla con su animación, el contenido o el pie pueden pedir `close()`
 * (también la reciben `children` y `footer` si son funciones). onClose se llama cuando ya terminó de cerrarse.
 */
export default function Sheet({ title, subtitle, onClose, children, footer, size = 'auto', className = '', titleHidden, dismissible = true, labelledBy, bare }) {
  const titleId = useId();
  const panel = useRef(null);
  const trigger = useRef(typeof document !== 'undefined' ? document.activeElement : null);
  const [closing, setClosing] = useState(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const closingRef = useRef(false);

  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    if (prefersReducedMotion()) onCloseRef.current?.();
    else setClosing(true);
  }, []);

  useLayoutEffect(() => {
    const entry = { requestClose: () => requestClose(), panel: panel.current };
    const unregister = registerSheet(entry);
    const t = trigger.current;
    return () => {
      unregister();
      if (t && document.contains(t) && typeof t.focus === 'function') t.focus({ preventScroll: true });
    };
  }, [requestClose]);

  // Foco inicial y foco atrapado dentro de la hoja.
  useEffect(() => {
    const el = panel.current;
    const first = el?.querySelector('[data-autofocus]');
    if (!el?.contains(document.activeElement)) (first || el)?.focus({ preventScroll: true });
    const onKey = (e) => {
      if (sheets[sheets.length - 1]?.panel !== el) return; // sólo la hoja de arriba
      if (e.key === 'Escape' && dismissible) { e.stopPropagation(); requestClose(); }
      if (e.key !== 'Tab' || !el) return;
      const f = [...el.querySelectorAll(FOCUSABLE)].filter((x) => x.offsetParent !== null);
      if (!f.length) { e.preventDefault(); return; }
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [dismissible, requestClose]);

  // Arrastrar hacia abajo desde el agarre o el título: la hoja sigue el dedo y se cierra pasado el 30 % o si va rápido.
  const drag = useRef(null);
  const onPointerDown = (e) => {
    if (!dismissible || e.button > 0 || e.target.closest('button, a, input, select, textarea')) return;
    drag.current = { y: e.clientY, t: performance.now(), dy: 0 };
    panel.current.style.transition = 'none';
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d) return;
    d.dy = Math.max(0, e.clientY - d.y);
    panel.current.style.transform = `translateY(${d.dy}px)`;
  };
  const onPointerUp = (e) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    const el = panel.current;
    const v = d.dy / Math.max(1, performance.now() - d.t);
    el.style.transition = '';
    if (d.dy > el.offsetHeight * 0.3 || (v > 0.5 && d.dy > 24)) {
      haptic('light');
      el.style.transform = `translateY(${d.dy}px)`;
      requestClose();
    } else {
      el.style.transform = '';
    }
  };

  const ctx = { close: requestClose };
  const body = typeof children === 'function' ? children(ctx) : children;
  const foot = typeof footer === 'function' ? footer(ctx) : footer;

  return createPortal(
    <div className={`m-sheet-root ${closing ? 'is-closing' : ''}`}>
      <div className="m-scrim" onClick={dismissible ? requestClose : undefined} aria-hidden="true" />
      <div ref={panel} className={`m-sheet m-sheet--${size} ${className}`} role="dialog" aria-modal="true"
        aria-labelledby={labelledBy || (title && !bare ? titleId : undefined)} aria-label={bare ? title : undefined} tabIndex={-1}
        onAnimationEnd={(e) => { if (closing && e.target === panel.current) onCloseRef.current?.(); }}>
        <div className="m-sheet__top" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
          <span className="m-sheet__grip" aria-hidden="true" />
          {!bare && (title || dismissible) && (
            <div className="m-sheet__head">
              <div style={{ minWidth: 0, flex: 1 }}>
                {title && <h2 id={titleId} className={titleHidden ? 'sr-only' : ''}>{title}</h2>}
                {subtitle && <p>{subtitle}</p>}
              </div>
              {dismissible && <button type="button" className="m-icon-btn m-sheet__close" onClick={requestClose} aria-label="Cerrar"><X size={20} /></button>}
            </div>
          )}
        </div>
        <div className="m-sheet__body">{body}</div>
        {foot && <div className="m-sheet__foot">{foot}</div>}
      </div>
    </div>,
    document.body,
  );
}

/**
 * Menú de acciones (⋯): grupos de opciones y «Cancelar». Al elegir, se cierra y luego se ejecuta la acción
 * (si la acción abre otra hoja, ésta toma la entrada del historial).
 */
export function ActionSheet({ title, groups, onClose }) {
  return (
    <Sheet title={title} titleHidden={!title} onClose={onClose} className="m-actions">
      {({ close }) => (
        <>
          {groups.map((g, gi) => {
            const items = g.filter((a) => a && !a.hidden);
            if (!items.length) return null;
            return (
              <div key={gi} className="m-actions__group">
                {items.map((a) => (
                  a.href ? (
                    // El enlace se quita después del toque: si se quitara antes, el navegador no lo abriría.
                    <a key={a.label} className={`m-actions__item ${a.danger ? 'danger' : ''}`} href={a.href} {...(a.linkProps || {})}
                      onClick={() => { a.onSelect?.(); setTimeout(onClose, 0); }}>
                      {a.icon && <a.icon size={20} aria-hidden="true" />}<span>{a.label}</span>
                    </a>
                  ) : (
                    <button key={a.label} type="button" className={`m-actions__item ${a.danger ? 'danger' : ''}`} disabled={a.disabled}
                      onClick={() => { a.onSelect?.(); onClose(); }}>
                      {a.icon && <a.icon size={20} aria-hidden="true" />}<span>{a.label}</span>
                    </button>
                  )
                ))}
              </div>
            );
          })}
          <button type="button" className="m-actions__cancel" onClick={close}>Cancelar</button>
        </>
      )}
    </Sheet>
  );
}
