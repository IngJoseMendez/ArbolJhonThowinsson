import { useCallback, useEffect, useMemo, useState } from 'react';
import { ClipboardCheck, Clock, Crown, Network, Search, Send, X } from 'lucide-react';
import { api, qs } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { CAMPAIGN, JohnPhoto, Logo, Mark } from '../../brand/Brand.jsx';
import { useCached } from '../../lib/cache.js';
import { relTime } from '../../lib/format.js';
import { useGo, useSwitchTab } from '../../lib/nav.js';
import { teamName, useTeams } from '../../lib/teams.js';
import { useOneTimeInvite } from '../../lib/invites.js';
import { inviteText } from '../../lib/whatsapp.js';
import Screen, { BarButton } from '../../components/m/Screen.jsx';
import { Chip, Chips, EmptyState, Group, Row, RowsSkeleton, Section } from '../../components/m/List.jsx';
import { DayBars, PersonAvatar, Sparkline, TeamAvatar, TrendChart } from '../../components/m/Spark.jsx';
import { openSearch } from '../../components/m/SearchOverlay.jsx';
import { InviteButton, useRoleTypes } from '../../components/invite/InviteBlocks.jsx';
import { RoleIcon } from '../../components/ui.jsx';

const nf = new Intl.NumberFormat('es');
const greeting = () => { const h = new Date().getHours(); return h >= 5 && h < 12 ? 'Buenos días' : h >= 12 && h < 19 ? 'Buenas tardes' : 'Buenas noches'; };

/** «13 nuevas desde su última visita»: se compara con el total guardado en este dispositivo hace más de una hora. */
function useSinceLastVisit(total) {
  const [since, setSince] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem('m-since') || 'null'); } catch { return null; }
  });
  useEffect(() => {
    if (total === undefined || since) return;
    let prev = null;
    try { prev = JSON.parse(localStorage.getItem('m-last') || 'null'); } catch { /* */ }
    const value = prev && Date.now() - prev.at > 36e5 && total > prev.total ? { n: total - prev.total, at: prev.at } : { n: 0, at: prev?.at || 0 };
    setSince(value);
    try {
      sessionStorage.setItem('m-since', JSON.stringify(value));
      localStorage.setItem('m-last', JSON.stringify({ total, at: Date.now() }));
    } catch { /* */ }
  }, [total, since]);
  return since;
}

/** El total sube hasta su valor (600 ms) la primera vez que se abre en la sesión; sin animación si se pidió reducirla. */
function useCountUp(target) {
  const [value, setValue] = useState(() => {
    try { return sessionStorage.getItem('m-countup') || window.matchMedia('(prefers-reduced-motion: reduce)').matches ? target : 0; } catch { return target; }
  });
  useEffect(() => {
    if (target === undefined) return undefined;
    let done;
    try { done = !!sessionStorage.getItem('m-countup'); } catch { done = true; }
    if (done || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setValue(target); return undefined; }
    try { sessionStorage.setItem('m-countup', '1'); } catch { /* */ }
    const t0 = performance.now();
    let raf = 0;
    const tick = (t) => {
      const k = Math.min(1, (t - t0) / 600);
      setValue(Math.round(target * (1 - (1 - k) ** 3)));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return target === undefined ? undefined : value ?? target;
}

/** Cambio de cada equipo en 7 días y su curva de 14 días, a partir del crecimiento acumulado. */
function teamPace(growth) {
  const out = new Map();
  const s = growth?.series || [];
  if (!s.length) return out;
  const last = s[s.length - 1];
  const weekAgo = s[Math.max(0, s.length - 8)];
  for (const h of growth.heads) {
    out.set(h.id, {
      delta: (last.values[h.id] || 0) - (weekAgo.values[h.id] || 0),
      spark: s.slice(-14).map((d) => d.values[h.id] || 0),
    });
  }
  return out;
}

/** Botón del escenario: invitar una cabeza (general), un líder (una sola cabeza) o ir a Invitar. */
function StageInvite({ a, teams }) {
  const go = useGo();
  const head = useRoleTypes('head').base;
  const leader = useRoleTypes('leader').base;
  const single = !a.isSuper && teams.manageable.length === 1 ? teams.manageable[0] : null;
  const role = a.isSuper ? 'head' : 'leader';
  const cabeza = single?.cabeza_name || null;
  const makeText = useCallback(({ url, name }) => inviteText({ role, name, cabeza, url }), [role, cabeza]);
  const invite = useOneTimeInvite({
    typeId: a.isSuper ? head?.id : leader?.id, headId: single?.id, role, cabeza, makeText,
    enabled: a.isSuper ? !!head : !!(leader && single),
  });
  if (!a.isSuper && !single) {
    return <button type="button" className="m-wa" onClick={() => go('/invitar')}><Send size={19} />Invitar un líder</button>;
  }
  const first = a.isSuper && teams.list.length === 0;
  return <InviteButton invite={invite}>{a.isSuper ? (first ? 'Invitar la primera cabeza' : 'Invitar una cabeza') : 'Invitar un líder'}</InviteButton>;
}

/** «Juan Carlos Restrepo aún no tiene líderes [Invitar líder]»: la invitación lista para esa cabeza. */
function NoLeadersRow({ head }) {
  const leader = useRoleTypes('leader').base;
  const makeText = useCallback(({ url, name }) => inviteText({ role: 'leader', name, cabeza: head.cabeza_name, url }), [head.cabeza_name]);
  const invite = useOneTimeInvite({ typeId: leader?.id, headId: head.id, role: 'leader', cabeza: head.cabeza_name, makeText, enabled: !!leader });
  return (
    <Row lead={<span className="m-today-icon"><Crown size={18} /></span>} title={`${head.cabeza_name} aún no tiene líderes`}
      meta="Cada líder suma a su propia gente.">
      <InviteButton invite={invite} className="m-wa--sm">Invitar líder</InviteButton>
    </Row>
  );
}

export default function Home() {
  const a = useAuth();
  const go = useGo();
  const switchTab = useSwitchTab();
  const teams = useTeams();
  const [days, setDays] = useState(30);
  const dash = useCached('dash:30', () => api.get('/stats/dashboard?days=30'), { ttl: 30000 });
  const trend = useCached(`dash:${days}`, () => api.get(`/stats/dashboard?days=${days}`), { ttl: 30000 });
  const open = useCached('links:open:20', () => api.get(`/links${qs({ one_time: 1, state: 'open', pageSize: 20 })}`), { ttl: 30000 });
  const pending = useCached('counts:pending', () => api.get('/pending?count=1'), { ttl: 60000 });
  const t = dash.data?.totals;
  const since = useSinceLastVisit(t?.people);
  const shown = useCountUp(t?.people);
  const [seen, setSeen] = useState(() => { try { return JSON.parse(localStorage.getItem('m-seen-heads') || 'null'); } catch { return null; } });

  const pace = useMemo(() => teamPace(dash.data?.growth), [dash.data]);
  const pendingN = pending.data?.count ?? t?.pending ?? 0;
  const leadersOnly = t ? Math.max(0, t.leaders - teams.list.filter((h) => h.cabeza_name && h.status === 'active').length) : 0;
  const first = String(a.user.display_name || '').trim().split(/\s+/)[0];
  const formalName = /administrador|coordinador|coordinaci/i.test(a.user.display_name || '') || a.user.display_name === a.user.role_label;

  // Celebración: una cabeza nueva (persona) en los últimos 7 días que aún no se ha visto en este dispositivo.
  useEffect(() => {
    if (!teams.data || seen) return;
    const ids = teams.list.map((h) => h.id);
    setSeen(ids);
    try { localStorage.setItem('m-seen-heads', JSON.stringify(ids)); } catch { /* */ }
  }, [teams.data, teams.list, seen]);
  const fresh = seen ? teams.list.find((h) => h.cabeza_name && !seen.includes(h.id) && Date.now() - Date.parse(h.created_at) < 7 * 864e5) : null;
  const dismissFresh = () => {
    const ids = [...(seen || []), fresh.id];
    setSeen(ids);
    try { localStorage.setItem('m-seen-heads', JSON.stringify(ids)); } catch { /* */ }
  };

  // Para hoy: lo que pide atención, en orden de prioridad (como máximo tres).
  const today = useMemo(() => {
    const out = [];
    if (pendingN > 0) out.push({ key: 'pending', icon: ClipboardCheck, title: `${pendingN} ${pendingN === 1 ? 'registro espera' : 'registros esperan'} su aprobación`, to: '/pendientes' });
    const soon = (open.data?.rows || []).filter((l) => Date.parse(l.expires_at) - Date.now() < 2 * 864e5);
    if (soon.length) out.push({ key: 'soon', icon: Clock, title: `${soon.length} ${soon.length === 1 ? 'invitación vence' : 'invitaciones vencen'} en menos de 2 días sin usarse`, to: '/enlaces?estado=sin-usar' });
    const lonely = teams.manageable.find((h) => h.cabeza_name && (h.leaders ?? 0) <= 1);
    if (lonely) out.push({ key: 'lonely', head: lonely });
    const quiet = teams.active.find((h) => (h.people ?? 0) > 1 && pace.get(h.id)?.delta === 0);
    if (quiet) out.push({ key: 'quiet', icon: Network, title: `${teamName(quiet)} no sumó gente esta semana`, to: `/cabezas/${quiet.id}` });
    if (a.isSuper) {
      const vacant = teams.active.find((h) => !h.cabeza_name);
      if (vacant) out.push({ key: 'vacant', icon: Mark, title: `${vacant.name} no tiene cabeza asignada`, to: `/cabezas/${vacant.id}` });
    }
    return out.slice(0, 3);
  }, [pendingN, open.data, teams, pace, a.isSuper]);

  const topTeams = useMemo(() => [...teams.active]
    .sort((x, y) => (pace.get(y.id)?.delta || 0) - (pace.get(x.id)?.delta || 0) || (y.people || 0) - (x.people || 0)).slice(0, 5), [teams.active, pace]);
  const lastVisitAt = since?.at || 0;
  const points = useMemo(() => (trend.data?.growth.series || []).map((s) => ({ day: s.day, value: Object.values(s.values).reduce((n, v) => n + v, 0) })), [trend.data]);

  const stage = (
    <div className="m-stage">
      <JohnPhoto variant="hero" className="m-stage__photo" alt="" eager />
      <div className="m-stage__text">
        <p className="m-stage__hello">{greeting()}{!formalName && first ? `, ${first}` : ''}</p>
        {t ? (
          <>
            <span className="m-stage__num" aria-label={nf.format(t.people)}>{nf.format(shown ?? t.people)}</span>
            <span className="m-stage__label">{a.isSuper ? 'personas en la red' : 'personas en sus equipos'}</span>
            <span className="m-stage__delta">+{nf.format(t.last7)} esta semana</span>
          </>
        ) : (
          <>
            <span className="skeleton m-sk-num" />
            <span className="m-stage__label" aria-hidden="true">&nbsp;</span>
            <span className="m-stage__delta" aria-hidden="true">&nbsp;</span>
          </>
        )}
        {/* Siempre ocupa su línea (vacía si no hay nuevas): así el escenario no cambia de alto. */}
        <span className="m-stage__since">{since?.n > 0 ? `${nf.format(since.n)} ${since.n === 1 ? 'nueva' : 'nuevas'} desde su última visita` : '\u00a0'}</span>
      </div>
      {dash.data ? <DayBars days={dash.data.growth.series.slice(-7).map((s) => ({ day: s.day, n: s.new }))} /> : <div className="m-daybars" aria-hidden="true" />}
      <div className="m-stage__stats">
        {t ? (
          <>
            <button type="button" className="m-stage__stat" onClick={() => switchTab('cabezas')}><b>{nf.format(t.heads)}</b>{t.heads === 1 ? 'cabeza' : 'cabezas'}</button>
            <button type="button" className="m-stage__stat" onClick={() => go('/lideres')}><b>{nf.format(leadersOnly)}</b>{leadersOnly === 1 ? 'líder' : 'líderes'}</button>
            {pendingN > 0 && <button type="button" className="m-stage__stat is-warn" onClick={() => go('/pendientes')}><b>{nf.format(pendingN)}</b>por aprobar</button>}
          </>
        ) : <span className="m-stage__stat" aria-hidden="true">&nbsp;</span>}
      </div>
      <div className="m-stage__cta"><StageInvite a={a} teams={teams} /></div>
    </div>
  );

  return (
    <Screen title="Inicio" stage left={<Logo tone="sky" className="m-bar__logo" />}
      actions={<BarButton icon={Search} label="Buscar" onClick={openSearch} />}
      heroTitle={(ref) => <span ref={ref} className="sr-only">Inicio</span>} hero={stage}>
      {fresh && (
        <div className="m-celebrate" role="status">
          <span className="celebrate-rise"><Mark /></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <b>{fresh.cabeza_name} aceptó su invitación: ya es cabeza.</b>
            <div className="row-wrap">
              <button type="button" className="btn btn-sm btn-primary" onClick={() => { dismissFresh(); go(`/cabezas/${fresh.id}`); }}>Ver su equipo</button>
            </div>
          </div>
          <button type="button" className="m-icon-btn" aria-label="Cerrar" onClick={dismissFresh}><X size={18} /></button>
        </div>
      )}

      <Section title="Para hoy">
        {!dash.data || !teams.data || !open.data ? <RowsSkeleton rows={2} /> : today.length ? (
          <Group>
            {today.map((r) => (r.head ? <NoLeadersRow key={r.key} head={r.head} /> : (
              <Row key={r.key} lead={<span className="m-today-icon"><r.icon size={18} /></span>} title={r.title} to={r.to} />
            )))}
          </Group>
        ) : <p className="m-note">Todo al día. Cuando algo necesite su atención, aparecerá aquí.</p>}
      </Section>

      <Section title="Cabezas esta semana" action={<button type="button" className="m-link-btn" onClick={() => switchTab('cabezas')}>Ver todas</button>}>
        {teams.loading ? <RowsSkeleton rows={3} /> : topTeams.length ? (
          <Group>
            {topTeams.map((h) => {
              const p = pace.get(h.id);
              const leaders = Math.max(0, (h.leaders || 0) - (h.cabeza_name ? 1 : 0));
              return (
                <Row key={h.id} lead={<TeamAvatar head={h} />} title={teamName(h)} to={`/cabezas/${h.id}`}
                  meta={`${h.cabeza_name ? `${leaders} ${leaders === 1 ? 'líder' : 'líderes'}` : 'Sin cabeza asignada'}, ${h.people || 0} ${h.people === 1 ? 'persona' : 'personas'}${teams.twin(h) ? `, ${teams.twin(h)}` : ''}`}
                  trail={<span className="m-trail-spark"><span className={`m-delta ${p?.delta ? '' : 'is-zero'}`}>+{p?.delta || 0}</span><Sparkline values={p?.spark} color={h.color} /></span>} chevron={false} />
              );
            })}
          </Group>
        ) : <EmptyState icon={Network} title="Aún no hay cabezas">{a.isSuper ? 'Invite la primera: ella arma su equipo.' : 'Pida al administrador general que le asigne una.'}</EmptyState>}
      </Section>

      <Section title="Recién registrados" action={<button type="button" className="m-link-btn" onClick={() => switchTab('personas')}>Ver todos</button>}>
        {dash.loading ? <RowsSkeleton rows={4} /> : dash.data?.recent.length ? (
          <Group>
            {dash.data.recent.slice(0, 8).map((r) => {
              const team = teams.name(r.head_id) || r.head_name;
              const meta = r.inviter_name
                ? (r.inviter_name === team ? `con ${r.inviter_name}` : `con ${r.inviter_name}, equipo de ${team}`)
                : r.is_head ? `Nueva cabeza, con ${CAMPAIGN}` : `Líder de ${team}`;
              return (
                <Row key={r.id} className={lastVisitAt && Date.parse(r.created_at) > lastVisitAt ? 'is-new' : ''} to={`/personas/${r.id}`}
                  lead={<PersonAvatar name={r.full_name} leader={r.is_leader} head={r.is_head} />}
                  title={<>{r.full_name}<RoleIcon isHead={r.is_head} isLeader={r.is_leader} size={13} /></>}
                  meta={r.status === 'pending' ? <><span className="badge badge-warning">Por aprobar</span> {meta}</> : meta}
                  trail={<small>{relTime(r.created_at)}</small>} chevron={false} />
              );
            })}
          </Group>
        ) : <EmptyState title="Aún no hay registros">Cuando alguien se registre con una invitación, aparecerá aquí.</EmptyState>}
      </Section>

      <Section title="Así crece la red">
        <div className="card m-chart-card">
          <Chips label="Periodo">
            {[[30, '30 días'], [90, '90 días'], [365, '1 año']].map(([d, l]) => <Chip key={d} active={days === d} onClick={() => setDays(d)}>{l}</Chip>)}
          </Chips>
          {points.length ? <TrendChart points={points} label="Personas en la red" /> : <div className="m-trend-skeleton skeleton" />}
        </div>
      </Section>
    </Screen>
  );
}
