import { useCallback, useEffect, useLayoutEffect } from 'react';
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { prefersReducedMotion } from './device.js';

// Navegación del celular: pestañas de la barra inferior, botón «atrás», memoria de desplazamiento y títulos.
//
// El historial se mantiene corto, como en una app: [primera pantalla, raíz de la pestaña, pantallas de esa pestaña…].
// Cambiar de pestaña reemplaza lo de la pestaña anterior; en Android, «atrás» desde una pestaña vuelve al inicio y
// otra vez sale de la app.

const ADMIN_TABS = [
  { key: 'inicio', root: '/', match: /^\/$/ },
  { key: 'cabezas', root: '/cabezas', match: /^\/cabezas(\/|$)/ },
  { key: 'invitar', root: '/invitar', match: /^\/(invitar|enlaces)$/ },
  { key: 'personas', root: '/personas', match: /^\/(personas(\/|$)|pendientes$)/ },
  { key: 'mas', root: '/mas', match: /^\/(mas|lideres|arbol|ubicaciones|usuarios|auditoria|tipos|cuenta)$/ },
];
// Líderes con cuenta: su inicio, su árbol, sus personas y «Más» (sin invitaciones: las crea la coordinación).
const LEADER_TABS = [
  { key: 'inicio', root: '/', match: /^\/$/ },
  { key: 'arbol', root: '/arbol', match: /^\/arbol$/ },
  { key: 'personas', root: '/personas', match: /^\/personas(\/|$)/ },
  { key: 'mas', root: '/mas', match: /^\/(mas|lideres|ubicaciones|cuenta)$|^\/cabezas(\/|$)/ },
];
let TABS = ADMIN_TABS;
/** Pestañas según el rol (las personas registradas con cuenta: su ficha y su rama). */
export function setTabsFor(role, person) {
  if (role === 'super_admin' || role === 'head_admin') TABS = ADMIN_TABS;
  else if (role === 'leader') TABS = LEADER_TABS;
  else {
    const mine = person ? `/personas/${person.id}` : '/';
    TABS = [
      { key: 'ficha', root: mine, match: new RegExp(`^${mine}$`) },
      { key: 'rama', root: '/arbol', match: /^\/arbol$/ },
      { key: 'mas', root: '/mas', match: /^\/(mas|cuenta|personas\/\d+)$/ },
    ];
  }
  return TABS;
}
export const currentTabs = () => TABS;
export const tabOf = (pathname) => TABS.find((t) => t.match.test(pathname))?.key || TABS[0].key;
export const tabRoot = (key) => TABS.find((t) => t.key === key)?.root || '/';
/** La pestaña encendida en una pantalla: la de donde se abrió (si vino de otra pestaña) o la de su ruta. */
export const activeTab = (loc) => loc.state?.tab ?? tabOf(loc.pathname);

const PARENTS = [
  [/^\/cabezas\/[^/]+$/, '/cabezas'],
  [/^\/personas\/[^/]+$/, '/personas'],
  [/^\/pendientes$/, '/personas'],
  [/^\/enlaces$/, '/invitar'],
  [/^\/(lideres|arbol|ubicaciones|usuarios|auditoria|tipos|cuenta)$/, '/mas'],
];
export const parentOf = (pathname) => PARENTS.find(([re]) => re.test(pathname))?.[1] || null;

export const ROUTE_TITLES = {
  '/': 'Inicio', '/cabezas': 'Cabezas', '/invitar': 'Invitar', '/personas': 'Personas', '/mas': 'Más', '/enlaces': 'Enlaces',
  '/pendientes': 'Por aprobar', '/lideres': 'Líderes', '/arbol': 'Árbol completo', '/ubicaciones': 'Ubicaciones',
  '/usuarios': 'Usuarios y roles', '/auditoria': 'Auditoría', '/tipos': 'Tipos de registro', '/cuenta': 'Mi cuenta',
};

// --- Pila de rutas por posición del historial (para saber a dónde lleva «atrás») ---------------------------------
// Cada posición guarda la ruta y la pestaña que estaba encendida en ella.
const STACK_KEY = 'm-stack';
const readStack = () => { try { return JSON.parse(sessionStorage.getItem(STACK_KEY) || '[]'); } catch { return []; } };
const writeStack = (s) => { try { sessionStorage.setItem(STACK_KEY, JSON.stringify(s.slice(0, 60))); } catch { /* sin almacenamiento */ } };
const entryPath = (e) => (typeof e === 'string' ? e : e?.p || '').split('?')[0];
const entryTab = (e) => (e && typeof e === 'object' && e.t) || tabOf(entryPath(e));
const histIdx = () => window.history.state?.idx ?? 0;

/** Registra la ruta actual (y su pestaña) en su posición del historial. */
export function useTrackStack() {
  const loc = useLocation();
  useEffect(() => {
    const s = readStack();
    const i = histIdx();
    s[i] = { p: loc.pathname + loc.search, t: activeTab(loc) };
    s.length = i + 1;
    writeStack(s);
  }, [loc]);
}

// --- Transiciones entre pantallas -------------------------------------------------------------------------------
// Al entrar a una pantalla, la nueva llega desde la derecha (iPhone) o con un desliz corto (Android); al volver, al
// revés. La transición espera a que la pantalla nueva esté lista (o 700 ms como máximo). Sin soporte del navegador o con
// «reducir movimiento», se navega sin animación.
let commitResolve = null;
/** La pantalla nueva ya está en el DOM: la transición puede capturarla. */
export function screenCommitted() { const r = commitResolve; commitResolve = null; r?.(); }
function withTransition(dir, fn) {
  const html = document.documentElement;
  if (!document.startViewTransition || prefersReducedMotion() || !html.classList.contains('m-phone') || html.classList.contains('m-sheet-open')) { fn(); return; }
  html.dataset.nav = dir;
  try {
    const t = document.startViewTransition(() => new Promise((resolve) => {
      commitResolve = resolve;
      fn();
      setTimeout(() => { if (commitResolve === resolve) { commitResolve = null; resolve(); } }, 700);
    }));
    t.finished.finally(() => { if (html.dataset.nav === dir) delete html.dataset.nav; });
  } catch {
    delete html.dataset.nav;
    fn();
  }
}

// --- Título de la pantalla actual (lo usa la siguiente como «‹ Título») -------------------------------------------
let currentTitle = '';
export function useScreenTitle(title) {
  useEffect(() => { currentTitle = title || ''; }, [title]);
}

/** Ir a otra pantalla dentro de la pestaña: recuerda la pestaña encendida y el título para el botón «atrás». */
export function useGo() {
  const navigate = useNavigate();
  const loc = useLocation();
  return useCallback((to, opts = {}) => {
    const tab = opts.tab ?? loc.state?.tab ?? tabOf(loc.pathname);
    // Desde una hoja abierta se reemplaza su entrada del historial: «atrás» no vuelve a una hoja ya cerrada.
    const replace = opts.replace ?? !!window.history.state?.mSheet;
    const go = () => navigate(to, { replace, state: { ...(opts.state || {}), tab, from: opts.from ?? currentTitle } });
    if (replace) go(); else withTransition('push', go);
  }, [navigate, loc.state, loc.pathname]);
}

/**
 * A dónde lleva «atrás»: a la pantalla anterior si se llegó desde ella dentro de la app (aunque sea de otra pestaña,
 * como una persona abierta desde el Inicio), o si es su padre o de la misma pestaña; si se llegó directo (WhatsApp,
 * recarga), a su padre. `label`: el título de ese destino.
 */
export function backTarget(loc, fallback) {
  const i = histIdx();
  const parent = fallback || parentOf(loc.pathname) || '/';
  const prev = i > 0 ? readStack()[i - 1] : null;
  const prevPath = prev ? entryPath(prev) : null;
  const inApp = loc.state?.from !== undefined;
  if (i > 0 && (inApp || (prevPath && (prevPath === parent || entryTab(prev) === activeTab(loc))))) {
    return { pop: true, label: loc.state?.from || ROUTE_TITLES[prevPath] || ROUTE_TITLES[parent] };
  }
  return { pop: false, path: parent, label: ROUTE_TITLES[parent] };
}

/** «Atrás» (ver backTarget): volver de verdad conserva el desplazamiento de la pantalla anterior. */
export function useBack(fallback) {
  const navigate = useNavigate();
  const loc = useLocation();
  return useCallback(() => {
    const t = backTarget(loc, fallback);
    if (t.pop) withTransition('pop', () => navigate(-1));
    else withTransition('pop', () => navigate(t.path, { replace: true, state: { tab: tabOf(t.path) } }));
  }, [navigate, loc, fallback]);
}

// --- Cambio de pestaña ----------------------------------------------------------------------------------------------
let pendingReplace = null;
const TAB_MEMORY = 'm-tabs';
const TAB_MEMORY_MS = 30 * 60e3;
const readTabs = () => { try { return JSON.parse(sessionStorage.getItem(TAB_MEMORY) || '{}'); } catch { return {}; } };
// Últimas personas abiertas desde el buscador (sólo en memoria).
let recentPeople = [];
export const recentSearches = () => recentPeople;
export const rememberSearch = (p) => { recentPeople = [p, ...recentPeople.filter((r) => r.id !== p.id)].slice(0, 8); };

/** Al cerrar sesión: se olvidan las pantallas recordadas por pestaña y las búsquedas recientes. */
export const forgetTabs = () => {
  recentPeople = [];
  try { sessionStorage.removeItem(TAB_MEMORY); sessionStorage.removeItem(STACK_KEY); } catch { /* */ }
};

/** Recuerda la última pantalla de cada pestaña (30 minutos): bajo la pestaña encendida, no la de su ruta. */
export function useTabMemory() {
  const loc = useLocation();
  useEffect(() => {
    const t = readTabs();
    t[activeTab(loc)] = { path: loc.pathname + loc.search, at: Date.now() };
    try { sessionStorage.setItem(TAB_MEMORY, JSON.stringify(t)); } catch { /* */ }
  }, [loc]);
}

/**
 * Ir a una pestaña. Si ya es la activa: fuera de su raíz vuelve a la raíz; en la raíz sube al principio de la lista.
 * Si es otra: abre su última pantalla (o la raíz) reemplazando lo de la pestaña anterior.
 */
export function useSwitchTab() {
  const navigate = useNavigate();
  const loc = useLocation();
  // Termina un cambio de pestaña que necesitó volver primero a la posición 1 del historial.
  useEffect(() => {
    if (!pendingReplace) return;
    const target = pendingReplace;
    pendingReplace = null;
    navigate(target.to, { replace: true, state: { tab: target.tab } });
  }, [loc.key, navigate]);
  return useCallback((key) => {
    const current = activeTab(loc);
    const root = tabRoot(key);
    let to = root;
    if (key === current) {
      if (loc.pathname === root) {
        window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
        return 'top';
      }
    } else {
      const mem = readTabs()[key];
      if (mem && Date.now() - mem.at < TAB_MEMORY_MS && mem.path !== loc.pathname + loc.search) to = mem.path;
    }
    const i = histIdx();
    const first = entryPath(readStack()[0]);
    if (i > 0 && first === to.split('?')[0]) { window.history.go(-i); return 'go'; }
    if (i === 0) { navigate(to, { state: { tab: key } }); return 'push'; }
    if (i === 1) { navigate(to, { replace: true, state: { tab: key } }); return 'replace'; }
    pendingReplace = { to, tab: key };
    window.history.go(-(i - 1));
    return 'go';
  }, [loc, navigate]);
}

// --- Desplazamiento: arriba al entrar, donde estaba al volver -------------------------------------------------------
const positions = new Map();
let lastPath = null;
export function useScrollMemory() {
  const loc = useLocation();
  const type = useNavigationType();
  useEffect(() => {
    const key = loc.key;
    let raf = 0;
    const save = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => positions.set(key, window.scrollY)); };
    window.addEventListener('scroll', save, { passive: true });
    return () => { cancelAnimationFrame(raf); window.removeEventListener('scroll', save); };
  }, [loc.key]);
  useLayoutEffect(() => {
    const samePath = lastPath === loc.pathname;
    lastPath = loc.pathname;
    if (type === 'POP' && positions.has(loc.key)) {
      const y = positions.get(loc.key);
      // La pantalla puede tardar un instante en tener su alto final (datos en caché): se intenta dos veces.
      window.scrollTo(0, y);
      requestAnimationFrame(() => window.scrollTo(0, y));
    } else if (type === 'REPLACE' && samePath) {
      // Cambiar un filtro o una sección de la misma pantalla no la sube al principio.
    } else {
      window.scrollTo(0, 0);
    }
  }, [loc.key, type, loc.pathname]);
}
