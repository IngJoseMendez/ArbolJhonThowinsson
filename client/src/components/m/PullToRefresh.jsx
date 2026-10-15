import { useEffect, useRef, useState } from 'react';
import { Mark } from '../../brand/Brand.jsx';
import { haptic } from '../../lib/device.js';

const THRESHOLD = 64;

/**
 * Tirar hacia abajo para actualizar, sólo en la app instalada (allí el celular no lo trae). La marca de Thowinsson
 * baja con el dedo y, al soltar pasado el umbral, gira mientras se actualiza la pantalla.
 */
export default function PullToRefresh({ enabled, onRefresh }) {
  const [dy, setDy] = useState(0);
  const [busy, setBusy] = useState(false);
  const refresh = useRef(onRefresh);
  refresh.current = onRefresh;
  useEffect(() => {
    if (!enabled) return undefined;
    let startY = null;
    let pulling = false;
    let current = 0;
    let crossed = false;
    const onStart = (e) => {
      startY = null;
      if (window.scrollY > 0 || document.documentElement.classList.contains('m-sheet-open') || e.touches.length > 1) return;
      if (e.target.closest?.('.tree-canvas, .m-sheet, input, textarea, select, .m-trend')) return;
      startY = e.touches[0].clientY;
      pulling = false; current = 0; crossed = false;
    };
    const onMove = (e) => {
      if (startY === null) return;
      const d = e.touches[0].clientY - startY;
      if (d <= 0 || window.scrollY > 0) { if (pulling) setDy(0); pulling = false; return; }
      pulling = true;
      current = Math.min(110, d * 0.5);
      if (!crossed && current >= THRESHOLD) { crossed = true; haptic('light'); }
      setDy(current);
      if (e.cancelable) e.preventDefault(); // sin el rebote del navegador mientras se tira
    };
    const onEnd = async () => {
      if (startY === null) return;
      startY = null;
      if (pulling && current >= THRESHOLD) {
        setBusy(true); setDy(56);
        try { await refresh.current(); } finally { setBusy(false); setDy(0); }
      } else setDy(0);
      pulling = false; current = 0;
    };
    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd);
    document.addEventListener('touchcancel', onEnd);
    return () => {
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      document.removeEventListener('touchcancel', onEnd);
    };
  }, [enabled]);
  if (!enabled || (!dy && !busy)) return null;
  return (
    <div className={`m-ptr ${busy ? 'is-busy' : ''} ${dy >= THRESHOLD ? 'is-ready' : ''}`} style={{ '--d': `${dy}px` }} role="status" aria-live="polite">
      <Mark />
      <span className="sr-only">{busy ? 'Actualizando' : 'Suelte para actualizar'}</span>
    </div>
  );
}
