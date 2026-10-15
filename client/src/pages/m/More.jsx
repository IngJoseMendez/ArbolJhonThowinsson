import { ClipboardCheck, Crown, Download, GitBranch, LogOut, MapPin, Palette, ScrollText, ShieldCheck, UserCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { useCached } from '../../lib/cache.js';
import { installMode } from '../../lib/pwa.js';
import { setTheme, useTheme } from '../../lib/theme.js';
import Screen from '../../components/m/Screen.jsx';
import { ActionRow, Group, Section, Segmented } from '../../components/m/List.jsx';
import { openInstallPrompt } from '../../components/InstallPrompt.jsx';
import { Avatar } from '../../components/ui.jsx';

/** Apariencia: automático (la del celular), claro u oscuro. */
function Appearance() {
  useTheme();
  const chosen = document.documentElement.dataset.theme || 'auto';
  return (
    <div className="m-appearance">
      <span>Apariencia</span>
      <Segmented label="Apariencia" value={chosen} onChange={setTheme}
        options={[{ value: 'auto', label: 'Automático' }, { value: 'light', label: 'Claro' }, { value: 'dark', label: 'Oscuro' }]} />
    </div>
  );
}

/** «Más»: el resto de la coordinación y la cuenta, en listas como los Ajustes del celular. */
export default function More() {
  const a = useAuth();
  const nav = useNavigate();
  const admin = a.isAdmin;
  const pending = useCached(admin ? 'counts:pending' : null, () => api.get('/pending?count=1'), { ttl: 60000 });
  const geo = useCached(admin ? 'counts:geo' : null, () => api.get('/geo/pending'), { ttl: 120000 });
  const geoN = (geo.data || []).reduce((n, g) => n + g.people, 0);
  const scope = a.isSuper ? 'Todas las cabezas' : a.user.role === 'head_admin' ? `${a.user.head_ids.length} ${a.user.head_ids.length === 1 ? 'cabeza' : 'cabezas'}` : a.user.role_label;
  const twofa = a.me?.twofa?.enabled;
  const logout = async () => { await a.logout(); nav('/login', { replace: true }); };
  return (
    <Screen title="Más">
      <div className="card m-me">
        <Avatar name={a.user.display_name} size="lg" />
        <div style={{ minWidth: 0 }}>
          <b>{a.user.display_name}</b>
          <span>{scope}</span>
        </div>
      </div>

      {a.user.role !== 'member' && (
        <Section title="La red">
          <Group>
            {admin && <ActionRow icon={ClipboardCheck} to="/pendientes" value={pending.data?.count || null}>Por aprobar</ActionRow>}
            <ActionRow icon={Crown} to="/lideres">Líderes</ActionRow>
            <ActionRow icon={GitBranch} to="/arbol">Árbol completo</ActionRow>
            {admin && <ActionRow icon={MapPin} to={geoN ? '/ubicaciones?tab=verificar' : '/ubicaciones'} value={geoN ? `${geoN} por verificar` : null}>Ubicaciones</ActionRow>}
          </Group>
        </Section>
      )}

      {admin && (
        <Section title="Administración">
          <Group>
            <ActionRow icon={ShieldCheck} to="/usuarios">Usuarios y roles</ActionRow>
            <ActionRow icon={Palette} to="/tipos">Tipos de registro y colores</ActionRow>
            {a.isSuper && <ActionRow icon={ScrollText} to="/auditoria">Auditoría</ActionRow>}
          </Group>
        </Section>
      )}

      <Section title="Su cuenta">
        <Group>
          <ActionRow icon={UserCircle} to="/cuenta" value={twofa ? null : 'Proteger'}>
            Mi cuenta<span className="list-row__sub">Contraseña y verificación en dos pasos</span>
          </ActionRow>
          <Appearance />
          {installMode() && <ActionRow icon={Download} onClick={openInstallPrompt} chevron={false}>Instalar en este celular</ActionRow>}
          <ActionRow icon={LogOut} onClick={logout} danger chevron={false}>Cerrar sesión</ActionRow>
        </Group>
      </Section>
    </Screen>
  );
}
