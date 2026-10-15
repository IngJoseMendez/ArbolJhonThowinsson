import { useLocation } from 'react-router-dom';
import { Ellipsis, EllipsisVertical, GitBranch, House, Network, Send, UserCircle, Users } from 'lucide-react';
import { osName } from '../../lib/device.js';
import { currentTabs, tabOf, useSwitchTab } from '../../lib/nav.js';

const META = {
  inicio: { label: 'Inicio', icon: House },
  cabezas: { label: 'Cabezas', icon: Network },
  invitar: { label: 'Invitar', icon: Send },
  personas: { label: 'Personas', icon: Users },
  mas: { label: 'Más', icon: null },
  arbol: { label: 'Árbol', icon: GitBranch },
  ficha: { label: 'Mi ficha', icon: UserCircle },
  rama: { label: 'Mi rama', icon: GitBranch },
};

/** Al tocar «Personas» estando ya en la lista, se enfoca la búsqueda (el teclado se abre en el mismo toque). */
const focusSearch = () => document.querySelector('[data-tab-search]')?.focus();

/**
 * Barra inferior de la app. «Invitar» va en el centro como un disco relleno: es la acción principal y nunca queda
 * escondida en un menú. Los números (por aprobar) van en una pastilla azul, nunca dorada.
 */
export default function TabBar({ counts = {} }) {
  const loc = useLocation();
  const switchTab = useSwitchTab();
  const tabs = currentTabs();
  const active = loc.state?.tab && tabs.some((t) => t.key === loc.state.tab) ? loc.state.tab : tabOf(loc.pathname);
  const MoreIcon = osName() === 'android' ? EllipsisVertical : Ellipsis;
  return (
    <nav className="m-tabbar" aria-label="Secciones">
      {tabs.map((t) => {
        const m = META[t.key];
        const Icon = t.key === 'mas' ? MoreIcon : m.icon;
        const badge = t.key === 'personas' ? counts.pending : 0;
        const dot = t.key === 'mas' && counts.geo > 0;
        const on = active === t.key;
        return (
          <button key={t.key} type="button" className={`m-tab ${t.key === 'invitar' ? 'm-tab--invite' : ''}`} aria-current={on ? 'page' : undefined}
            aria-label={badge ? `${m.label}, ${badge} por aprobar` : dot ? `${m.label}, hay ubicaciones por verificar` : m.label}
            onClick={() => { const r = switchTab(t.key); if (r === 'top' && t.key === 'personas') focusSearch(); }}>
            <span className="m-tab__icon" aria-hidden="true">
              {t.key === 'invitar' ? <span className="m-tab__disc"><Send size={21} strokeWidth={2.1} /></span> : <Icon size={24} strokeWidth={on ? 2.2 : 1.9} />}
              {badge > 0 && <span className="m-badge">{badge > 99 ? '99+' : badge}</span>}
              {dot && <span className="m-dot" />}
            </span>
            <span className="m-tab__label">{m.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
