import { useEffect, useState } from 'react';

// Aplicación instalable.
// - Android y PC (Chrome, Edge, Samsung Internet): el navegador avisa con «beforeinstallprompt»; la app muestra su propio
//   botón «Instalar» y, al tocarlo, aparece la ventana del sistema que pide permiso e instala al instante.
// - iPhone y Mac con Safari: Apple no permite instalar desde la página; se muestran los dos toques (Compartir → Agregar a inicio).

let deferred = null;
const listeners = new Set();
const notify = () => listeners.forEach((fn) => fn());
const INSTALLED = 'pwa-installed';
const local = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } },
};
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    notify();
  });
  window.addEventListener('appinstalled', () => { deferred = null; local.set(INSTALLED, '1'); notify(); });
}

export const isStandalone = () => typeof window !== 'undefined'
  && (window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true);

export const isIOS = () => typeof navigator !== 'undefined'
  && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

/**
 * Cómo se instala en este navegador:
 * 'prompt' (botón Instalar), 'ios' (Safari o Chrome de iPhone), 'ios-inapp' (navegador dentro de otra app en iPhone),
 * 'mac' (Safari de Mac), 'android-inapp' (navegador dentro de otra app en Android) o null (no se puede).
 */
export function installMode() {
  if (typeof navigator === 'undefined' || isStandalone()) return null;
  if (deferred) return 'prompt';
  const ua = navigator.userAgent;
  if (isIOS()) return /Safari\//.test(ua) || /CriOS|EdgiOS/.test(ua) ? 'ios' : 'ios-inapp';
  if (/Android/.test(ua) && /; wv\)|FBAN|FBAV|Instagram|Line\/|Snapchat|TikTok/.test(ua)) return 'android-inapp';
  if (/Macintosh/.test(ua) && /Version\/[\d.]+.*Safari\//.test(ua) && !/Chrome|Chromium|Edg\//.test(ua)) return 'mac';
  return null;
}

export const wasInstalled = () => local.get(INSTALLED) === '1';

/** «Ahora no»: el aviso vuelve a aparecer pasados unos días, sin insistir. */
export const snoozeInstall = (days = 3) => local.set('pwa-snooze', String(Date.now() + days * 864e5));
export const installSnoozed = () => Number(local.get('pwa-snooze') || 0) > Date.now();

/** Registra el service worker (sólo en la versión publicada). */
export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
}

/** Estado de instalación: puede mostrarse el aviso del sistema (Android y PC) o los pasos de iPhone. */
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
    mode: installMode(),
    prompt: async () => {
      if (!deferred) return false;
      deferred.prompt();
      const { outcome } = await deferred.userChoice.catch(() => ({ outcome: 'dismissed' }));
      deferred = null;
      if (outcome === 'accepted') local.set(INSTALLED, '1');
      notify();
      return outcome === 'accepted';
    },
  };
}

/**
 * Mientras se ve un panel, la app instalable abre ese panel (y no la página de acceso):
 * el manifiesto apunta al panel y el nombre del ícono es «Mi panel». Además se recuerda el panel en este dispositivo
 * para que la app, si se instaló con el manifiesto general, también abra el panel.
 */
export function usePanelManifest(token) {
  useEffect(() => {
    if (!token) return undefined;
    const link = document.querySelector('link[rel="manifest"]');
    const title = document.querySelector('meta[name="apple-mobile-web-app-title"]');
    const prev = { href: link?.getAttribute('href'), title: title?.getAttribute('content') };
    const href = `/api/public/manifest?start=${encodeURIComponent(`/panel/${token}`)}`;
    if (link && link.getAttribute('href') !== href) link.setAttribute('href', href);
    title?.setAttribute('content', 'Mi panel');
    local.set('last-panel', `/panel/${token}`);
    return () => {
      if (link && prev.href && prev.href !== href) link.setAttribute('href', prev.href);
      if (title && prev.title) title.setAttribute('content', prev.title);
    };
  }, [token]);
}

export const forgetPanel = () => local.set('last-panel', null);

/** La app instalada se abre en «/?app=1»: en un celular de líder o cabeza, va directo a su panel. */
export function launchToPanel() {
  if (typeof window === 'undefined' || window.location.pathname !== '/') return;
  if (!new URLSearchParams(window.location.search).has('app')) return;
  const last = local.get('last-panel');
  if (last && /^\/panel\/[A-Za-z0-9_-]{20,60}$/.test(last) && !local.get('admin-device')) window.history.replaceState(null, '', last);
}

/** Este dispositivo usa la coordinación: la app instalada abre la coordinación, no un panel. */
export const markAdminDevice = () => local.set('admin-device', '1');
