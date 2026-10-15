import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Network, GitBranch, Crown, Users, Link2, ShieldCheck, ScrollText, LogOut, Moon, Sun, UserPlus, UserCircle, MapPin, Ellipsis,
} from 'lucide-react';
import { useAuth } from '../auth.jsx';
import { api } from '../api.js';
import { Avatar, PersonPicker } from './ui.jsx';
import RegisterPersonModal from './RegisterPersonModal.jsx';
import { Logo, Monogram, Mark } from '../brand/Brand.jsx';

/** Secciones de la aplicación según el rol (la barra inferior del celular muestra las primeras). */
function sections(a, counts) {
  const role = a.user.role;
  if (role === 'member') {
    return [
      { to: `/personas/${a.person?.id}`, icon: UserCircle, label: 'Mi ficha', short: 'Mi ficha' },
      { to: '/arbol', icon: GitBranch, label: 'Mi rama', short: 'Mi rama' },
    ];
  }
  const list = [
    { to: '/', end: true, icon: LayoutDashboard, label: 'Inicio', short: 'Inicio' },
    { to: '/arbol', icon: GitBranch, label: 'Árbol', short: 'Árbol' },
    { to: '/cabezas', icon: Network, label: 'Cabezas', short: 'Cabezas' },
    { to: '/personas', icon: Users, label: 'Personas', short: 'Personas' },
    { to: '/lideres', icon: Crown, label: 'Líderes', short: 'Líderes' },
    { to: '/enlaces', icon: Link2, label: 'Enlaces e invitaciones', short: 'Enlaces', count: counts.pending },
    { to: counts.geo ? '/ubicaciones?tab=verificar' : '/ubicaciones', match: '/ubicaciones', icon: MapPin, label: 'Ubicaciones', short: 'Ubicaciones', count: counts.geo, countTitle: 'Ubicaciones por verificar' },
  ];
  if (role === 'leader' && a.person) list.push({ to: `/personas/${a.person.id}`, icon: UserCircle, label: 'Mi ficha', short: 'Mi ficha' });
  return list;
}

export default function Layout() {
  const a = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [more, setMore] = useState(false);
  const [pending, setPending] = useState(0);
  const [geoPending, setGeoPending] = useState(0);
  const [registering, setRegistering] = useState(false);
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || '');

  useEffect(() => setMore(false), [loc.pathname, loc.search]);
  useEffect(() => {
    if (!a.isAdmin) return;
    api.get('/pending').then((r) => setPending(r.length)).catch(() => {});
    api.get('/geo/pending').then((r) => setGeoPending(r.reduce((n, g) => n + g.people, 0))).catch(() => {});
  }, [a.isAdmin, loc.pathname]);
  useEffect(() => {
    if (!more) return undefined;
    const k = (e) => e.key === 'Escape' && setMore(false);
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [more]);

  const isDark = theme ? theme === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  const toggleTheme = () => {
    const next = isDark ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('theme', next); } catch { /* */ }
    setTheme(next);
  };
  const logout = async () => { await a.logout(); nav('/login'); };

  const items = sections(a, { pending, geo: geoPending });
  const admin = a.isAdmin ? [
    { to: '/usuarios', icon: ShieldCheck, label: 'Usuarios y roles' },
    ...(a.isSuper ? [{ to: '/auditoria', icon: ScrollText, label: 'Auditoría' }] : []),
  ] : [];
  // Celular: cuatro accesos directos y «Más» con el resto.
  const tabs = items.length <= 5 ? items : items.slice(0, 4);
  const rest = items.length <= 5 ? [] : items.slice(4);
  const restCount = rest.reduce((n, i) => n + (i.count || 0), 0);
  const restActive = rest.some((i) => loc.pathname.startsWith(i.match || i.to)) || admin.some((i) => loc.pathname.startsWith(i.to));
  const link = (i, cls) => (
    <NavLink key={i.label} to={i.to} end={i.end} className={({ isActive }) => `${cls || ''} ${isActive || (i.match && loc.pathname.startsWith(i.match)) ? 'active' : ''}`}>
      <i.icon size={cls === 'tab' ? 22 : 19} strokeWidth={cls === 'tab' ? 1.9 : 2} />
      {cls === 'tab' ? i.short : i.label}
      {i.count > 0 && <span className={cls === 'tab' ? 'tab-count' : 'count'} title={i.countTitle}>{i.count}</span>}
    </NavLink>
  );

  return (
    <div className="app">
      <aside className="sidebar" aria-label="Navegación">
        <div className="brand">
          <Logo tone="sky" />
          <span className="brand-sub">Equipo John Thowinsson</span>
        </div>
        <nav className="nav" aria-label="Principal">
          {items.map((i) => link(i))}
          {admin.length > 0 && (
            <>
              <div className="nav-section">Administración</div>
              {admin.map((i) => link(i))}
            </>
          )}
        </nav>
        <div className="sidebar-foot">
          <Avatar name={a.user.display_name} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="ellipsis" style={{ fontWeight: 600 }}>{a.user.display_name}</div>
            <div className="small muted ellipsis">{a.user.role_label}</div>
          </div>
          <button className="btn btn-ghost btn-sm btn-icon" onClick={toggleTheme} aria-label="Cambiar tema" title="Cambiar tema">
            {isDark ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <button className="btn btn-ghost btn-sm btn-icon" title="Cerrar sesión" aria-label="Cerrar sesión" onClick={logout}><LogOut size={16} /></button>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <span className="topbar-brand" aria-hidden="true"><Monogram /></span>
          <div className="topbar-search" style={{ width: 440, maxWidth: '100%' }}>
            <PersonPicker placeholder="Buscar por nombre, código o celular…" value={null}
              onChange={(p) => p && nav(`/personas/${p.id}`)} />
          </div>
          <div className="spacer hide-mobile" />
          {a.isAdmin && (
            <button className="btn btn-primary" onClick={() => setRegistering(true)} aria-label="Registrar persona">
              <UserPlus size={17} /><span className="hide-sm">Registrar persona</span>
            </button>
          )}
        </header>
        <Outlet />
      </div>

      <nav className="tabbar" aria-label="Secciones" style={{ '--tabs': tabs.length + 1 }}>
        {tabs.map((i) => link(i, 'tab'))}
        <button type="button" className={restActive || more ? 'active' : ''} onClick={() => setMore(true)} aria-haspopup="dialog" aria-expanded={more}>
          <Ellipsis size={22} strokeWidth={1.9} />Más
          {restCount > 0 && <span className="tab-count">{restCount}</span>}
        </button>
      </nav>
      <div className={`more-sheet ${more ? 'open' : ''}`} role="dialog" aria-modal="true" aria-label="Más opciones" hidden={!more}>
        <div className="more-back" onClick={() => setMore(false)} />
        <div className="more-panel">
          <div className="sheet-grip" />
          <div className="more-user">
            <Avatar name={a.user.display_name} size="lg" />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="ellipsis" style={{ fontWeight: 600, fontSize: 17 }}>{a.user.display_name}</div>
              <div className="small muted">{a.user.role_label}</div>
            </div>
            <Mark size={26} style={{ color: 'var(--sky)' }} />
          </div>
          <div className="more-list">
            {rest.map((i) => link(i))}
            {admin.map((i) => link(i))}
            <button type="button" onClick={toggleTheme}>{isDark ? <Sun size={19} /> : <Moon size={19} />}{isDark ? 'Tema claro' : 'Tema oscuro'}</button>
            <button type="button" onClick={logout}><LogOut size={19} />Cerrar sesión</button>
          </div>
        </div>
      </div>
      {registering && <RegisterPersonModal onClose={() => setRegistering(false)} onCreated={(p) => nav(`/personas/${p.id}`)} />}
    </div>
  );
}
