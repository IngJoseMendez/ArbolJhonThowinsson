import { useEffect, useState, useSyncExternalStore } from 'react';
import { isIOS, isStandalone } from './pwa.js';

// Celular: pantalla angosta, o táctil y baja (un celular acostado sigue siendo celular).
const PHONE_QUERY = '(max-width: 900px), (pointer: coarse) and (max-height: 520px)';
const phoneMq = typeof window !== 'undefined' ? window.matchMedia(PHONE_QUERY) : null;
export const isPhoneNow = () => !!phoneMq?.matches;
const subscribePhone = (cb) => { phoneMq?.addEventListener('change', cb); return () => phoneMq?.removeEventListener('change', cb); };
export const useIsPhone = () => useSyncExternalStore(subscribePhone, isPhoneNow, () => false);

const session = {
  get: (k) => { try { return sessionStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { sessionStorage.setItem(k, v); } catch { /* sin almacenamiento */ } },
};

/**
 * Marca el sistema en <html data-os="ios|android|other"> y si la app está instalada (data-standalone). Sólo cambian
 * costumbres de cada plataforma (botón atrás, título, desenfoque…), nunca los datos ni las funciones.
 * Para revisar: ?os=ios|android&standalone=1 lo fija en esta pestaña.
 */
export function applyPlatform() {
  const html = document.documentElement;
  const p = new URLSearchParams(window.location.search);
  if (p.get('os')) session.set('qa-os', p.get('os'));
  if (p.get('standalone')) session.set('qa-standalone', p.get('standalone'));
  let os = session.get('qa-os');
  if (!['ios', 'android', 'other'].includes(os)) os = isIOS() ? 'ios' : /Android/i.test(navigator.userAgent) ? 'android' : 'other';
  html.dataset.os = os;
  const qa = session.get('qa-standalone');
  if (qa === '1' || (qa === null && isStandalone())) html.dataset.standalone = '1';
  else delete html.dataset.standalone;
}
export const osName = () => document.documentElement.dataset.os || 'other';
export const isIOSStandalone = () => osName() === 'ios' && document.documentElement.dataset.standalone === '1';
export const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Vibración corta en Android al enviar, aprobar o confirmar (iPhone no lo permite desde la web). */
export function haptic(kind = 'light') {
  if (osName() === 'ios' || !navigator.vibrate) return;
  try { navigator.vibrate({ success: [10, 40, 12], warning: 20, light: 10 }[kind] ?? 10); } catch { /* sin vibración */ }
}

const TEXT_INPUT = /^(text|search|tel|email|number|password|url|date|datetime-local|time)$/;
const isTextField = (el) => !!el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && TEXT_INPUT.test(el.type || 'text')));

/**
 * Con el teclado abierto se esconde la barra inferior (html.kbd). En iPhone, --kb es el alto del teclado: los botones
 * fijos de las hojas quedan por encima.
 */
export function useKeyboardClass() {
  useEffect(() => {
    const html = document.documentElement;
    let t;
    const onIn = (e) => { if (isTextField(e.target)) { clearTimeout(t); html.classList.add('kbd'); } };
    const onOut = () => { clearTimeout(t); t = setTimeout(() => { if (!isTextField(document.activeElement)) html.classList.remove('kbd'); }, 100); };
    const vv = window.visualViewport;
    const onResize = () => {
      const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      html.style.setProperty('--kb', `${Math.round(kb)}px`);
    };
    document.addEventListener('focusin', onIn);
    document.addEventListener('focusout', onOut);
    if (vv && osName() === 'ios') vv.addEventListener('resize', onResize);
    return () => {
      clearTimeout(t);
      document.removeEventListener('focusin', onIn);
      document.removeEventListener('focusout', onOut);
      if (vv) vv.removeEventListener('resize', onResize);
      html.classList.remove('kbd');
      html.style.removeProperty('--kb');
    };
  }, []);
}

/** Al volver a la app tras `minMs` o más, se llama a `cb` (por ejemplo, para refrescar números). */
export function useResume(cb, minMs = 60e3) {
  useEffect(() => {
    let hiddenAt = 0;
    const fn = () => {
      if (document.visibilityState === 'hidden') hiddenAt = Date.now();
      else if (hiddenAt && Date.now() - hiddenAt >= minMs) cb();
    };
    document.addEventListener('visibilitychange', fn);
    return () => document.removeEventListener('visibilitychange', fn);
  }, [cb, minMs]);
}

export function useOnline() {
  const [online, setOnline] = useState(() => navigator.onLine !== false);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  return online;
}

/** Identificador aleatorio de este dispositivo (sólo para reutilizar la invitación preparada aquí). */
export function deviceKey() {
  try {
    let k = localStorage.getItem('m-device');
    if (!k || !/^[A-Za-z0-9_-]{8,40}$/.test(k)) {
      const bytes = crypto.getRandomValues(new Uint8Array(15));
      k = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      localStorage.setItem('m-device', k);
    }
    return k;
  } catch {
    return 'sin-almacenamiento';
  }
}
