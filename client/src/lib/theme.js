import { useEffect, useState } from 'react';

// Tema claro u oscuro: por defecto el del sistema; si la persona elige uno, se recuerda en este dispositivo.
const listeners = new Set();
const systemDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches;

/** 'light' | 'dark' | 'auto' (la del celular o el computador; se olvida la elección guardada). */
export function setTheme(next) {
  if (next === 'auto') {
    delete document.documentElement.dataset.theme;
    try { localStorage.removeItem('theme'); } catch { /* sin almacenamiento */ }
  } else {
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('theme', next); } catch { /* sin almacenamiento */ }
  }
  listeners.forEach((fn) => fn());
}

export function useTheme() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const fn = () => setTick((t) => t + 1);
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    listeners.add(fn);
    mq.addEventListener('change', fn);
    return () => { listeners.delete(fn); mq.removeEventListener('change', fn); };
  }, []);
  const chosen = document.documentElement.dataset.theme;
  const dark = chosen ? chosen === 'dark' : systemDark();
  return { dark, toggle: () => setTheme(dark ? 'light' : 'dark') };
}
