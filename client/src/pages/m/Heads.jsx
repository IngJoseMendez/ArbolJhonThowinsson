import { useCallback, useMemo, useState } from 'react';
import { Archive, ArrowDownUp, GitBranch, MoreHorizontal, MoreVertical, Network, Plus, Search } from 'lucide-react';
import { api } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { useCached, invalidate } from '../../lib/cache.js';
import { osName } from '../../lib/device.js';
import { useGo } from '../../lib/nav.js';
import { teamName, useTeams } from '../../lib/teams.js';
import Screen, { BarButton } from '../../components/m/Screen.jsx';
import { ActionSheet } from '../../components/m/Sheet.jsx';
import { EmptyState, Group, Row, RowsSkeleton, Section } from '../../components/m/List.jsx';
import { JohnAvatar, Sparkline, TeamAvatar } from '../../components/m/Spark.jsx';
import { CAMPAIGN } from '../../brand/Brand.jsx';
import { openSearch } from '../../components/m/SearchOverlay.jsx';
import { InviteButton, useRoleTypes } from '../../components/invite/InviteBlocks.jsx';
import { useOneTimeInvite } from '../../lib/invites.js';
import { inviteText } from '../../lib/whatsapp.js';
import { HeadFormModal } from '../Heads.jsx';

const day = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' });
const SORTS = { semana: 'Más crecen esta semana', personas: 'Más personas', nombre: 'Nombre (A–Z)' };

/** Fila «Invitar una cabeza»: la misma invitación preparada del Inicio y de Invitar (un toque a WhatsApp). */
function InviteHeadRow() {
  const head = useRoleTypes('head').base;
  const makeText = useCallback(({ url, name }) => inviteText({ role: 'head', name, url }), []);
  const invite = useOneTimeInvite({ typeId: head?.id, role: 'head', makeText, enabled: !!head });
  return (
    <div className="m-invite-row">
      <InviteButton invite={invite}>Invitar una cabeza</InviteButton>
      <p className="m-note">Arma su propio equipo de líderes y personas.</p>
    </div>
  );
}

/** Cabezas: cada equipo con su persona al frente, cuánto creció esta semana y quiénes esperan aprobación. */
export default function Heads() {
  const a = useAuth();
  const go = useGo();
  const teams = useTeams();
  const dash = useCached('dash:30', () => api.get('/stats/dashboard?days=30'), { ttl: 30000 });
  const [sort, setSort] = useState(() => { try { return sessionStorage.getItem('m-heads-sort') || 'semana'; } catch { return 'semana'; } });
  const [menu, setMenu] = useState(null);
  const [q, setQ] = useState('');
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const More = osName() === 'android' ? MoreVertical : MoreHorizontal;

  const pace = useMemo(() => {
    const out = new Map();
    const s = dash.data?.growth.series || [];
    if (!s.length) return out;
    const last = s[s.length - 1];
    const weekAgo = s[Math.max(0, s.length - 8)];
    for (const h of dash.data.growth.heads) out.set(h.id, { delta: (last.values[h.id] || 0) - (weekAgo.values[h.id] || 0), spark: s.slice(-14).map((d) => d.values[h.id] || 0) });
    return out;
  }, [dash.data]);
  // Homónimos: se distinguen por la región o por la fecha, nunca con «(2)».
  const dupNames = useMemo(() => {
    const c = new Map();
    for (const h of teams.list) c.set(teamName(h), (c.get(teamName(h)) || 0) + 1);
    return c;
  }, [teams.list]);

  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const list = useMemo(() => {
    const act = teams.list.filter((h) => h.status === 'active' && (!q || norm(teamName(h)).includes(norm(q)) || norm(h.region).includes(norm(q))));
    const by = {
      semana: (x, y) => (pace.get(y.id)?.delta || 0) - (pace.get(x.id)?.delta || 0) || (y.people || 0) - (x.people || 0),
      personas: (x, y) => (y.people || 0) - (x.people || 0),
      nombre: (x, y) => teamName(x).localeCompare(teamName(y), 'es'),
    }[sort];
    return act.sort(by);
  }, [teams.list, q, sort, pace]);
  const archived = teams.list.filter((h) => h.status !== 'active');

  const row = (h) => {
    const p = pace.get(h.id);
    const leaders = Math.max(0, (h.leaders || 0) - (h.cabeza_name ? 1 : 0));
    const name = teamName(h);
    const twin = dupNames.get(name) > 1 ? (h.region || `desde el ${day.format(new Date(h.created_at))}`) : null;
    const meta = h.cabeza_name
      ? `${leaders} ${leaders === 1 ? 'líder' : 'líderes'}, ${h.people || 0} ${h.people === 1 ? 'persona' : 'personas'}${twin ? `, ${twin}` : ''}`
      : `Sin cabeza asignada, ${h.people || 0} ${h.people === 1 ? 'persona' : 'personas'}`;
    return (
      <Row key={h.id} lead={<TeamAvatar head={h} />} title={name} to={`/cabezas/${h.id}`}
        meta={<>{meta}{h.pending > 0 && <> <span className="badge badge-warning">{h.pending} por aprobar</span></>}</>}
        trail={h.status === 'active' ? <span className="m-trail-spark"><span className={`m-delta ${p?.delta ? '' : 'is-zero'}`}>+{p?.delta || 0}</span><Sparkline values={p?.spark} color={h.color} /></span> : null}
        chevron={false} />
    );
  };

  return (
    <Screen title="Cabezas" count={teams.data ? list.length : undefined}
      actions={<>
        <BarButton icon={Search} label="Buscar" onClick={openSearch} />
        <BarButton icon={More} label="Más opciones" onClick={() => setMenu('more')} />
      </>}>
      {a.isSuper && <InviteHeadRow />}
      {/* John es la primera cabeza: de él cuelgan sus cabezas y las personas que invita directamente. Abre la red completa. */}
      <Group className="m-group--spaced">
        <Row lead={<JohnAvatar size={44} />} title={CAMPAIGN} to="/arbol" chevron
          meta={a.isSuper && dash.data?.totals ? `De él cuelga toda la red, ${dash.data.totals.people} ${dash.data.totals.people === 1 ? 'persona' : 'personas'}` : 'De él cuelga toda la red'} />
      </Group>
      {teams.list.length > 8 && (
        <input className="input m-filter-input" type="search" placeholder="Buscar cabeza" aria-label="Buscar cabeza" value={q} onChange={(e) => setQ(e.target.value)} />
      )}
      <Section title={SORTS[sort]} action={<button type="button" className="m-link-btn" onClick={() => setMenu('sort')}><ArrowDownUp size={16} />Ordenar</button>}>
        {teams.loading ? <RowsSkeleton rows={5} /> : list.length ? <Group>{list.map(row)}</Group> : (
          <EmptyState icon={Network} title={q ? 'Ninguna cabeza coincide' : 'Aún no hay cabezas'}>
            {q ? 'Pruebe con otro nombre.' : a.isSuper ? 'Invite la primera: ella arma su equipo.' : 'Pida al administrador general que le asigne una.'}
          </EmptyState>
        )}
      </Section>
      {archived.length > 0 && (
        <Section>
          <Group>
            <Row lead={<span className="m-today-icon"><Archive size={18} /></span>} title={`Archivadas (${archived.length})`} onClick={() => setArchivedOpen(!archivedOpen)} chevron />
            {archivedOpen && archived.map(row)}
          </Group>
        </Section>
      )}
      {menu === 'sort' && (
        <ActionSheet title="Ordenar por" onClose={() => setMenu((m) => (m === 'sort' ? null : m))} groups={[Object.entries(SORTS).map(([k, l]) => ({
          label: `${l}${k === sort ? '  ✓' : ''}`, onSelect: () => { setSort(k); try { sessionStorage.setItem('m-heads-sort', k); } catch { /* */ } },
        }))]} />
      )}
      {menu === 'more' && (
        <ActionSheet onClose={() => setMenu((m) => (m === 'more' ? null : m))} groups={[[
          { label: 'Ver el árbol', icon: GitBranch, onSelect: () => go('/arbol') },
          { label: 'Ordenar…', icon: ArrowDownUp, onSelect: () => setMenu('sort') },
          { label: 'Nueva estructura', icon: Plus, hidden: !a.isSuper, onSelect: () => setCreating(true) },
          { label: archivedOpen ? 'Ocultar archivadas' : 'Ver archivadas', icon: Archive, hidden: !archived.length, onSelect: () => setArchivedOpen(!archivedOpen) },
        ]]} />
      )}
      {creating && <HeadFormModal usedColors={teams.list.map((h) => h.color)} onClose={() => setCreating(false)}
        onSaved={(h) => { invalidate('heads'); if (h?.id) go(`/cabezas/${h.id}`); }} />}
    </Screen>
  );
}
