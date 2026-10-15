import { useEffect, useState } from 'react';

// Aplicación instalable: Android (aviso nativo de instalación) e iPhone (Compartir → Agregar a inicio).

let deferred = null;
const listeners = new Set();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    listeners.forEach((fn) => fn());
  });
  window.addEventListener('appinstalled', () => { deferred = null; listeners.forEach((fn) => fn()); });
}

export const isStandalone = () => typeof window !== 'undefined'
  && (window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true);

export const isIOS = () => typeof navigator !== 'undefined'
  && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

/** Registra el service worker (sólo en la versión publicada). */
export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
}

/** Estado de instalación: puede mostrarse el aviso de Android, o las instrucciones de iPhone. */
export function useInstall() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const fn = () => setTick((t) => t + 1);
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, []);
  return {
    standalone: isStandalone(),
    canPrompt: !!deferred,
    ios: isIOS(),
    prompt: async () => {
      if (!deferred) return false;
      deferred.prompt();
      const { outcome } = await deferred.userChoice.catch(() => ({ outcome: 'dismissed' }));
      deferred = null;
      listeners.forEach((f) => f());
      return outcome === 'accepted';
    },
  };
}

/**
 * Mientras se ve un panel, la app instalable abre ese panel (y no la página de acceso):
 * el manifiesto apunta al panel y el nombre del ícono es «Mi panel».
 */
export function usePanelManifest(token) {
  useEffect(() => {
    if (!token) return undefined;
    const link = document.querySelector('link[rel="manifest"]');
    const title = document.querySelector('meta[name="apple-mobile-web-app-title"]');
    const prev = { href: link?.getAttribute('href'), title: title?.getAttribute('content') };
    link?.setAttribute('href', `/api/public/manifest?start=${encodeURIComponent(`/panel/${token}`)}`);
    title?.setAttribute('content', 'Mi panel');
    return () => {
      if (link && prev.href) link.setAttribute('href', prev.href);
      if (title && prev.title) title.setAttribute('content', prev.title);
    };
  }, [token]);
}
