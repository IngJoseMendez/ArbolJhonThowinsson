import { useLocation } from 'react-router-dom';
import { ROUTE_TITLES, currentTabs, parentOf } from '../../lib/nav.js';
import Screen from '../../components/m/Screen.jsx';
import { TypesTab } from '../Links.jsx';

/**
 * Pantallas que conservan su contenido de siempre (usuarios, auditoría, ubicaciones, mi cuenta, árbol completo),
 * dentro de la app del celular: barra azul con su título y «atrás»; sus tablas se ven como tarjetas.
 */
export default function Legacy({ children, title, tree, root }) {
  const loc = useLocation();
  const t = title || ROUTE_TITLES[loc.pathname] || '';
  // La raíz de una pestaña (Personas y Árbol de un líder, «Mi ficha» de una persona) no lleva «atrás».
  const isRoot = root || currentTabs().some((t) => t.root === loc.pathname);
  const back = isRoot ? undefined : parentOf(loc.pathname) || '/mas';
  return (
    <Screen title={t} back={back} noHero={tree} className="m-legacy" bodyClassName={`m-cards ${tree ? 'm-tree' : ''}`}>
      {children}
    </Screen>
  );
}

/** Tipos de registro y colores en el celular. */
export function TypesScreen() {
  return <Legacy title="Tipos de registro"><div className="page"><TypesTab /></div></Legacy>;
}
