import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Network, GitBranch, Crown, Users, Link2, ShieldCheck, ScrollText, LogOut, Menu, Moon, Sun, UserPlus, UserCircle,
} from 'lucide-react';
import { useAuth } from '../auth.jsx';
import { api } from '../api.js';
import { Avatar, PersonPicker } from './ui.jsx';
import RegisterPersonModal from './RegisterPersonModal.jsx';

export default function Layout() {
  const a = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(0);
  const [registering, setRegistering] = useState(false);
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || '');

  useEffect(() => setOpen(false), [loc.pathname]);
  useEffect(() => {
    if (!a.isAdmin) return;
    api.get('/pending').then((r) => setPending(r.length)).catch(() => {});
  }, [a.isAdmin, loc.pathname]);

  const isDark = theme ? theme === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  const toggleTheme = () => {
    const dark = isDark;
    const next = dark ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('theme', next); } catch { /* */ }
    setTheme(next);
  };

  const role = a.user.role;
  return (
    <div className="app">
      <div className={`scrim ${open ? 'open' : ''}`} onClick={() => setOpen(false)} />
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="brand">
          <div className="brand-logo"><Network size={18} /></div>
          <div>Estructuras<div className="small muted" style={{ fontWeight: 500 }}>Árbol organizativo</div></div>
        </div>
        <nav className="nav" aria-label="Principal">
          {role === 'member' ? (
            <>
              <NavLink to={`/personas/${a.person?.id}`}><UserCircle size={18} />Mi ficha</NavLink>
              <NavLink to="/arbol"><GitBranch size={18} />Mi rama</NavLink>
            </>
          ) : (
            <>
              <NavLink to="/" end><LayoutDashboard size={18} />Dashboard</NavLink>
              <NavLink to="/arbol"><GitBranch size={18} />Árbol</NavLink>
              <NavLink to="/cabezas"><Network size={18} />Cabezas</NavLink>
              <NavLink to="/lideres"><Crown size={18} />Líderes</NavLink>
              <NavLink to="/personas"><Users size={18} />Personas</NavLink>
              <NavLink to="/enlaces"><Link2 size={18} />Enlaces e invitaciones{pending > 0 && <span className="count">{pending}</span>}</NavLink>
              {role === 'leader' && a.person && <NavLink to={`/personas/${a.person.id}`}><UserCircle size={18} />Mi ficha</NavLink>}
            </>
          )}
          {a.isAdmin && (
            <>
              <div className="nav-section">Administración</div>
              <NavLink to="/usuarios"><ShieldCheck size={18} />Usuarios y roles</NavLink>
              {a.isSuper && <NavLink to="/auditoria"><ScrollText size={18} />Auditoría</NavLink>}
            </>
          )}
        </nav>
        <div className="sidebar-foot">
          <Avatar name={a.user.display_name} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="ellipsis" style={{ fontWeight: 600 }}>{a.user.display_name}</div>
            <div className="small muted ellipsis">{a.user.role_label}</div>
          </div>
          <button className="btn btn-ghost btn-sm btn-icon" title="Cerrar sesión" aria-label="Cerrar sesión"
            onClick={async () => { await a.logout(); nav('/login'); }}><LogOut size={16} /></button>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <button className="btn btn-ghost btn-icon menu-btn" onClick={() => setOpen(true)} aria-label="Abrir menú"><Menu size={20} /></button>
          <div style={{ width: 420, maxWidth: '100%' }}>
            <PersonPicker placeholder="Buscar por nombre, identificador o teléfono…" value={null}
              onChange={(p) => p && nav(`/personas/${p.id}`)} />
          </div>
          <div className="spacer" />
          {a.isAdmin && (
            <button className="btn btn-primary" onClick={() => setRegistering(true)}>
              <UserPlus size={16} /><span className="hide-sm">Registrar persona</span>
            </button>
          )}
          <button className="btn btn-ghost btn-icon" onClick={toggleTheme} aria-label="Cambiar tema" title="Cambiar tema">
            {isDark ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </header>
        <Outlet />
      </div>
      {registering && <RegisterPersonModal onClose={() => setRegistering(false)} onCreated={(p) => nav(`/personas/${p.id}`)} />}
    </div>
  );
}
