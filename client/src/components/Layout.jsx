import { Suspense, useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Network, GitBranch, Crown, Users, Link2, ShieldCheck, ScrollText, LogOut, Moon, Sun, UserPlus, UserCircle, MapPin,
} from 'lucide-react';
import { useAuth } from '../auth.jsx';
import { Avatar, Loading, PersonPicker } from './ui.jsx';
import RegisterPersonModal from './RegisterPersonModal.jsx';
import ErrorBoundary from './ErrorBoundary.jsx';
import PhoneShell, { usePhoneCounts } from './m/PhoneShell.jsx';
import { Logo } from '../brand/Brand.jsx';
import { useIsPhone } from '../lib/device.js';
import { useTheme } from '../lib/theme.js';
import { invalidate } from '../lib/cache.js';

/** Secciones de la aplicación según el rol. */
function sections(a, counts) {
  const role = a.user.role;
  if (role === 'member') {
    return [
      { to: `/personas/${a.person?.id}`, icon: UserCircle, label: 'Mi ficha' },
      { to: '/arbol', icon: GitBranch, label: 'Mi rama' },
    ];
  }
  const list = [
    { to: '/', end: true, icon: LayoutDashboard, label: 'Inicio' },
    { to: '/arbol', icon: GitBranch, label: 'Árbol' },
    { to: '/cabezas', icon: Network, label: 'Cabezas' },
    { to: '/personas', icon: Users, label: 'Personas' },
    { to: '/lideres', icon: Crown, label: 'Líderes' },
    { to: '/enlaces', icon: Link2, label: 'Enlaces e invitaciones', count: counts.pending, countTitle: 'Registros por aprobar' },
    { to: counts.geo ? '/ubicaciones?tab=verificar' : '/ubicaciones', match: '/ubicaciones', icon: MapPin, label: 'Ubicaciones', count: counts.geo, countTitle: 'Ubicaciones por verificar' },
  ];
  if (role === 'leader' && a.person) list.push({ to: `/personas/${a.person.id}`, icon: UserCircle, label: 'Mi ficha' });
  return list;
}

/** En el celular, la app (barra inferior, hojas, pantallas propias); en el computador, menú lateral y barra superior. */
export default function Layout() {
  return useIsPhone() ? <PhoneShell /> : <DesktopLayout />;
}

function DesktopLayout() {
  const a = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const theme = useTheme();
  const [registering, setRegistering] = useState(false);
  const counts = usePhoneCounts(a.isAdmin);
  // Los números del menú se actualizan al cambiar de sección y cada minuto con la ventana a la vista.
  useEffect(() => { if (a.isAdmin) invalidate('counts:'); }, [loc.pathname, a.isAdmin]);
  useEffect(() => {
    if (!a.isAdmin) return undefined;
    const t = setInterval(() => { if (document.visibilityState === 'visible') invalidate('counts:'); }, 60e3);
    return () => clearInterval(t);
  }, [a.isAdmin]);

  const logout = async () => { await a.logout(); nav('/login'); };
  const items = sections(a, counts);
  const admin = a.isAdmin ? [
    { to: '/usuarios', icon: ShieldCheck, label: 'Usuarios y roles' },
    ...(a.isSuper ? [{ to: '/auditoria', icon: ScrollText, label: 'Auditoría' }] : []),
  ] : [];
  const link = (i) => (
    <NavLink key={i.label} to={i.to} end={i.end} className={({ isActive }) => (isActive || (i.match && loc.pathname.startsWith(i.match)) ? 'active' : '')}>
      <i.icon size={19} strokeWidth={2} />
      {i.label}
      {i.count > 0 && <span className="count" title={i.countTitle}>{i.count}</span>}
    </NavLink>
  );

  return (
    <div className="app">
      <aside className="sidebar" aria-label="Navegación">
        <div className="brand">
          <Logo tone="navy" />
          <span className="brand-sub">Equipo John Thowinsson</span>
        </div>
        <nav className="nav" aria-label="Principal">
          {items.map(link)}
          {admin.length > 0 && (
            <>
              <div className="nav-section">Administración</div>
              {admin.map(link)}
            </>
          )}
        </nav>
        <div className="sidebar-foot">
          <Link to="/cuenta" className="sidebar-user" title="Mi cuenta: contraseña y verificación en dos pasos">
            <Avatar name={a.user.display_name} />
            <span style={{ minWidth: 0, flex: 1 }}>
              <span className="ellipsis" style={{ fontWeight: 600, display: 'block' }}>{a.user.display_name}</span>
              <span className="small muted ellipsis" style={{ display: 'block' }}>{a.user.role_label}</span>
            </span>
          </Link>
          <button className="btn btn-ghost btn-sm btn-icon" onClick={theme.toggle} aria-label="Cambiar tema" title="Cambiar tema">
            {theme.dark ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <button className="btn btn-ghost btn-sm btn-icon" title="Cerrar sesión" aria-label="Cerrar sesión" onClick={logout}><LogOut size={16} /></button>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <div className="topbar-search" style={{ width: 440, maxWidth: '100%' }}>
            <PersonPicker placeholder="Buscar por nombre, código o celular…" value={null}
              onChange={(p) => p && nav(`/personas/${p.id}`)} />
          </div>
          <div className="spacer" />
          {a.isAdmin && (
            <button className="btn btn-primary" onClick={() => setRegistering(true)}>
              <UserPlus size={17} />Registrar persona
            </button>
          )}
        </header>
        <ErrorBoundary key={loc.pathname}>
          <Suspense fallback={<Loading />}><Outlet /></Suspense>
        </ErrorBoundary>
      </div>
      {registering && <RegisterPersonModal onClose={() => setRegistering(false)} onCreated={(p) => nav(`/personas/${p.id}`)} />}
    </div>
  );
}
