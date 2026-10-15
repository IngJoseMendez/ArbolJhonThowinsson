import { Suspense, useEffect } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth.jsx';
import { Loading } from './components/ui.jsx';
import { lazyPage } from './lib/lazyPage.js';
import { isPhoneNow, useIsPhone } from './lib/device.js';
import { preloadSession } from './auth.jsx';

// La coordinación se descarga por pantallas: cada una cuando se abre por primera vez.
const pages = {
  Login: () => import('./pages/Login.jsx'),
  Layout: () => import('./components/Layout.jsx'),
  Dashboard: () => import('./pages/Dashboard.jsx'),
  Heads: () => import('./pages/Heads.jsx'),
  HeadDetail: () => import('./pages/HeadDetail.jsx'),
  Leaders: () => import('./pages/Leaders.jsx'),
  TreeExplorer: () => import('./pages/TreeExplorer.jsx'),
  People: () => import('./pages/People.jsx'),
  Person: () => import('./pages/Person.jsx'),
  Links: () => import('./pages/Links.jsx'),
  Users: () => import('./pages/Users.jsx'),
  Audit: () => import('./pages/Audit.jsx'),
  Locations: () => import('./pages/Locations.jsx'),
  Account: () => import('./pages/Account.jsx'),
  // Celular
  MHome: () => import('./pages/m/Home.jsx'),
  MInvite: () => import('./pages/m/Invite.jsx'),
  MHeads: () => import('./pages/m/Heads.jsx'),
  MHead: () => import('./pages/m/Head.jsx'),
  MPeople: () => import('./pages/m/People.jsx'),
  MPerson: () => import('./pages/m/Person.jsx'),
  MPending: () => import('./pages/m/Pending.jsx'),
  MLinks: () => import('./pages/m/Links.jsx'),
  MMore: () => import('./pages/m/More.jsx'),
  MLeaders: () => import('./pages/m/Leaders.jsx'),
  MLegacy: () => import('./pages/m/Legacy.jsx'),
};
const P = Object.fromEntries(Object.entries(pages).map(([k, f]) => [k, lazyPage(f)]));

// Al abrir la app en el celular, la estructura (Layout), la pantalla pedida y la sesión se piden ya, en paralelo:
// sin esperar a que cada una termine para pedir la siguiente.
const PHONE_ROUTES = [[/^\/$/, 'MHome'], [/^\/invitar$/, 'MInvite'], [/^\/cabezas$/, 'MHeads'], [/^\/cabezas\/\d+$/, 'MHead'],
  [/^\/personas$/, 'MPeople'], [/^\/personas\/\d+$/, 'MPerson'], [/^\/pendientes$/, 'MPending'], [/^\/enlaces$/, 'MLinks'], [/^\/mas$/, 'MMore']];
if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
  preloadSession();
  if (isPhoneNow()) {
    pages.Layout().catch(() => {});
    const hit = PHONE_ROUTES.find(([re]) => re.test(window.location.pathname));
    if (hit) pages[hit[1]]().catch(() => {});
    // La foto del Inicio se pide desde ya (es lo más grande de la pantalla).
    if (window.location.pathname === '/') {
      const l = Object.assign(document.createElement('link'), { rel: 'preload', as: 'image', href: '/brand/john-hero.webp', type: 'image/webp' });
      l.setAttribute('fetchpriority', 'high');
      document.head.appendChild(l);
    }
  }
}
const MTypes = lazyPage(() => pages.MLegacy().then((m) => ({ default: m.TypesScreen })));

/** Con la sesión abierta, las pantallas más usadas se descargan en segundo plano: cambiar de pestaña es inmediato. */
function usePrefetch(enabled, phone) {
  useEffect(() => {
    if (!enabled) return undefined;
    const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1200));
    const cancel = window.cancelIdleCallback || clearTimeout;
    const keys = phone ? ['MInvite', 'MHeads', 'MHead', 'MPeople', 'MPerson', 'MMore'] : ['Heads', 'HeadDetail', 'Links', 'People', 'Person', 'TreeExplorer'];
    const id = idle(() => { for (const k of keys) pages[k]().catch(() => {}); });
    return () => cancel(id);
  }, [enabled, phone]);
}

function Protected({ children, admin, superOnly }) {
  const a = useAuth();
  const loc = useLocation();
  const phone = useIsPhone();
  usePrefetch(!!a.me && a.isAdmin, phone);
  if (a.loading) return <Loading />;
  if (!a.me) return <Navigate to="/login" state={{ from: loc.pathname + loc.search }} replace />;
  if (superOnly && !a.isSuper) return <Navigate to="/" replace />;
  if (admin && !a.isAdmin) return <Navigate to="/" replace />;
  return children;
}

/**
 * En el celular, la coordinación (administradores) usa sus pantallas propias; las demás pantallas se muestran dentro
 * de la app del celular con su barra. En el computador, todo sigue igual.
 */
function Adaptive({ phone, legacy, desktop }) {
  const a = useAuth();
  const isPhone = useIsPhone();
  if (!isPhone) return desktop;
  if (phone && a.isAdmin) return phone;
  return <P.MLegacy {...(legacy || {})}>{desktop}</P.MLegacy>;
}

function Home() {
  const a = useAuth();
  if (a.user?.role === 'member' && a.person) return <Navigate to={`/personas/${a.person.id}`} replace />;
  return <Adaptive phone={<P.MHome />} legacy={{ title: 'Inicio', root: true }} desktop={<P.Dashboard />} />;
}

/** La sesión sólo se consulta en la coordinación, no en el registro ni en los paneles públicos. */
function WithAuth() {
  return <AuthProvider><Suspense fallback={<Loading />}><Outlet /></Suspense></AuthProvider>;
}

/** Rutas sólo del celular: en el computador llevan a su equivalente. */
function PhoneOnly({ phone, to }) {
  return useIsPhone() ? phone : <Navigate to={to} replace />;
}

export default function AdminApp() {
  return (
    <Routes>
      <Route element={<WithAuth />}>
        <Route path="login" element={<P.Login />} />
        <Route element={<Protected><P.Layout /></Protected>}>
          <Route index element={<Home />} />
          <Route path="cabezas" element={<Adaptive phone={<P.MHeads />} desktop={<P.Heads />} />} />
          <Route path="cabezas/:id" element={<Adaptive phone={<P.MHead />} desktop={<P.HeadDetail />} />} />
          <Route path="lideres" element={<Adaptive phone={<P.MLeaders />} desktop={<P.Leaders />} />} />
          <Route path="arbol" element={<Adaptive legacy={{ tree: true }} desktop={<P.TreeExplorer />} />} />
          <Route path="personas" element={<Adaptive phone={<P.MPeople />} desktop={<P.People />} />} />
          <Route path="personas/:id" element={<Adaptive phone={<P.MPerson />} desktop={<P.Person />} />} />
          <Route path="enlaces" element={<Adaptive phone={<P.MLinks />} desktop={<P.Links />} />} />
          <Route path="invitar" element={<PhoneOnly phone={<Protected admin><P.MInvite /></Protected>} to="/enlaces" />} />
          <Route path="pendientes" element={<PhoneOnly phone={<Protected admin><P.MPending /></Protected>} to="/enlaces?tab=pendientes" />} />
          <Route path="tipos" element={<PhoneOnly phone={<Protected admin><MTypes /></Protected>} to="/enlaces?tab=tipos" />} />
          <Route path="mas" element={<PhoneOnly phone={<P.MMore />} to="/" />} />
          <Route path="ubicaciones" element={<Adaptive desktop={<P.Locations />} />} />
          <Route path="cuenta" element={<Adaptive desktop={<P.Account />} />} />
          <Route path="usuarios" element={<Protected admin><Adaptive desktop={<P.Users />} /></Protected>} />
          <Route path="auditoria" element={<Protected superOnly><Adaptive desktop={<P.Audit />} /></Protected>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Route>
    </Routes>
  );
}
