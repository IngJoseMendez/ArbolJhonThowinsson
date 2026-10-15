import { Suspense, useCallback, useEffect, useLayoutEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { useCached, invalidate } from '../../lib/cache.js';
import { useKeyboardClass, useResume } from '../../lib/device.js';
import { screenCommitted, setTabsFor, useScrollMemory, useTabMemory, useTrackStack } from '../../lib/nav.js';
import PullToRefresh from './PullToRefresh.jsx';
import ErrorBoundary from '../ErrorBoundary.jsx';
import InstallPrompt from '../InstallPrompt.jsx';
import TabBar from './TabBar.jsx';
import SearchOverlay from './SearchOverlay.jsx';
import { OfflineBanner, SentFeedback } from './Feedback.jsx';
import '../../phone.css';

/** Registros por aprobar y ubicaciones por verificar (números de la barra inferior). */
export function usePhoneCounts(enabled) {
  const pending = useCached(enabled ? 'counts:pending' : null, () => api.get('/pending?count=1'), { ttl: 60000 });
  const geo = useCached(enabled ? 'counts:geo' : null, () => api.get('/geo/pending'), { ttl: 120000 });
  return { pending: pending.data?.count || 0, geo: (geo.data || []).reduce((n, g) => n + g.people, 0) };
}

/** Mientras se carga una pantalla: la barra azul y filas grises (no un spinner en blanco). */
function ScreenFallback() {
  return (
    <div className="m-screen" aria-busy="true">
      <header className="m-bar"><div className="m-bar__row" /></header>
      <div className="m-hero"><span className="skeleton m-sk-title" /></div>
      <main className="m-body" />
    </div>
  );
}

/**
 * La app de coordinación en el celular: cada pantalla trae su barra y su cabecera; aquí van la barra inferior,
 * el buscador, los avisos de invitaciones enviadas, el aviso sin conexión y el de instalar la app.
 */
export default function PhoneShell() {
  const a = useAuth();
  const loc = useLocation();
  setTabsFor(a.user.role, a.person);
  useLayoutEffect(() => {
    const html = document.documentElement;
    html.classList.add('m-phone');
    return () => html.classList.remove('m-phone');
  }, []);
  useKeyboardClass();
  useTrackStack();
  useTabMemory();
  useScrollMemory();
  const counts = usePhoneCounts(a.isAdmin);
  // La pantalla nueva ya se pintó: la transición (si hay) puede seguir.
  useLayoutEffect(() => { screenCommitted(); }, [loc.key]);
  const standalone = document.documentElement.dataset.standalone === '1';
  const canPull = standalone && /^\/(|cabezas|invitar|personas|enlaces|pendientes|lideres|mas)$/.test(loc.pathname);
  const pullRefresh = useCallback(() => {
    invalidate('');
    window.dispatchEvent(new Event('m-refresh'));
    return new Promise((r) => setTimeout(r, 650));
  }, []);
  // Al volver a la app después de un rato, los números y la pantalla visible se actualizan solos.
  const onResume = useCallback(() => invalidate(''), []);
  useResume(onResume, 60e3);
  useEffect(() => {
    if (!a.isAdmin) return undefined;
    const t = setInterval(() => { if (document.visibilityState === 'visible') invalidate('counts:'); }, 60e3);
    return () => clearInterval(t);
  }, [a.isAdmin]);
  return (
    <div className="m-app">
      <ErrorBoundary key={loc.pathname}>
        <Suspense fallback={<ScreenFallback />}><Outlet /></Suspense>
      </ErrorBoundary>
      <PullToRefresh enabled={canPull} onRefresh={pullRefresh} />
      <TabBar counts={counts} />
      <SearchOverlay />
      <SentFeedback />
      <OfflineBanner />
      <InstallPrompt formal appName="Thowinsson" />
    </div>
  );
}
