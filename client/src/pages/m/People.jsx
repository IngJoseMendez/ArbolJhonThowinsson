import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search, SlidersHorizontal, UserPlus, Users } from 'lucide-react';
import { api, qs } from '../../api.js';
import { useCached, invalidate, onClear } from '../../lib/cache.js';
import { relTime, STATUS } from '../../lib/format.js';
import { useGo } from '../../lib/nav.js';
import { useQueryState } from '../../lib/useParams.js';
import { useRegTypes } from '../../lib/regTypes.js';
import { teamName, useTeams } from '../../lib/teams.js';
import Screen, { BarButton } from '../../components/m/Screen.jsx';
import { ActionSheet } from '../../components/m/Sheet.jsx';
import { Chip, Chips, EmptyState, Group, Row, RowsSkeleton } from '../../components/m/List.jsx';
import { PersonAvatar } from '../../components/m/Spark.jsx';
import { RoleIcon } from '../../components/ui.jsx';
import { CAMPAIGN } from '../../brand/Brand.jsx';
import RegisterPersonModal from '../../components/RegisterPersonModal.jsx';
import FiltersSheet, { FILTER_KEYS } from './FiltersSheet.jsx';

const PAGE = 30;
const nf = new Intl.NumberFormat('es');
const SORTS = {
  recientes: { label: 'Más recientes', sort: 'created_at', dir: 'desc' },
  nombre: { label: 'Nombre (A–Z)', sort: 'full_name', dir: 'asc' },
  rama: { label: 'Rama más grande', sort: 'descendants', dir: 'desc' },
};
const sortKey = (p) => Object.keys(SORTS).find((k) => SORTS[k].sort === (p.sort || 'created_at') && SORTS[k].dir === (p.dir || 'desc')) || 'recientes';
const isoDay = (d) => d.toISOString().slice(0, 10);
const weekStart = () => isoDay(new Date(Date.now() - 6 * 864e5));

// Lo cargado de cada búsqueda queda en memoria: al volver de una ficha, la lista y el desplazamiento siguen igual.
// Al salir de la cuenta se borra.
const lists = new Map();
onClear(() => lists.clear());

/** Personas: búsqueda, fichas de filtro y la lista completa que se carga a medida que se baja. */
export default function People() {
  const go = useGo();
  const teams = useTeams();
  const types = useRegTypes();
  const [params, setParams] = useQueryState();
  const [term, setTerm] = useState(params.q || '');
  const [sheet, setSheet] = useState(null);
  const pending = useCached('counts:pending', () => api.get('/pending?count=1'), { ttl: 60000 });
  const query = useMemo(() => {
    const out = { q: params.q, sort: params.sort, dir: params.dir };
    for (const k of FILTER_KEYS) out[k] = params[k];
    return out;
  }, [params]);
  const key = JSON.stringify(query);
  const [state, setState] = useState(() => lists.get(key) || { rows: [], total: null, page: 0, loading: true, error: null });
  const sentinel = useRef(null);
  const loadingRef = useRef(null);
  const gen = useRef(0);

  // Búsqueda con pausa de 300 ms (la URL guarda lo escrito).
  useEffect(() => {
    const t = setTimeout(() => { if ((params.q || '') !== term) setParams({ q: term || null }, true); }, 300);
    return () => clearTimeout(t);
  }, [term]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cada carga es de una vuelta: si mientras tanto cambió la búsqueda (o se actualizó), su respuesta se descarta.
  const load = async (page, base) => {
    if (loadingRef.current) return;
    const mine = { gen: gen.current };
    loadingRef.current = mine;
    try {
      const r = await api.get(`/people${qs({ ...query, page, pageSize: PAGE })}`);
      if (gen.current !== mine.gen) return;
      const next = { rows: page === 1 ? r.rows : [...base.rows, ...r.rows], total: r.total, page, loading: false, error: null, at: Date.now() };
      lists.set(key, next);
      setState(next);
    } catch (error) {
      if (gen.current === mine.gen) setState((s) => ({ ...s, loading: false, error }));
    } finally { if (loadingRef.current === mine) loadingRef.current = null; }
  };
  const restart = () => { gen.current++; loadingRef.current = null; };
  // Al cambiar la búsqueda o los filtros se empieza de nuevo (o se usa lo cargado hace menos de dos minutos).
  useEffect(() => {
    restart();
    const cached = lists.get(key);
    if (cached && Date.now() - cached.at < 120e3) { setState(cached); return; }
    setState({ rows: [], total: null, page: 0, loading: true, error: null });
    load(1, { rows: [] });
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onRefresh = () => { lists.delete(key); restart(); load(1, { rows: [] }); };
    window.addEventListener('m-refresh', onRefresh);
    return () => window.removeEventListener('m-refresh', onRefresh);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  // Carga continua: al acercarse al final se pide la página siguiente.
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return undefined;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !loadingRef.current && state.total !== null && state.rows.length < state.total) load(state.page + 1, state);
    }, { rootMargin: '600px 0px' });
    io.observe(el);
    return () => io.disconnect();
  });

  const filterCount = FILTER_KEYS.filter((k) => params[k] && !['comuna_id', 'barrio_id'].includes(k)).length;
  const thisWeek = params.from === weekStart() && !params.to;
  const onlyLeaders = params.type === 'leader';
  const pendingN = pending.data?.count || 0;
  const headFilter = params.head_id ? teams.byId.get(Number(params.head_id)) : null;
  const remove = (patch) => setParams(patch, true);
  const active = [
    headFilter && { k: 'head', label: teamName(headFilter), patch: { head_id: null, leader_id: null } },
    params.leader_id && { k: 'leader', label: 'Líder a cargo', patch: { leader_id: null } },
    params.inviter_id && { k: 'inviter', label: 'Invitados por una persona', patch: { inviter_id: null } },
    params.type && params.type !== 'leader' && { k: 'type', label: { head: 'Cabezas', person: 'Personas' }[params.type], patch: { type: null } },
    params.status && { k: 'status', label: params.status === 'pending' ? 'Por aprobar' : STATUS[params.status]?.label, patch: { status: null } },
    params.method && { k: 'method', label: params.method === 'manual' ? 'A mano' : 'Por enlace', patch: { method: null } },
    (params.from && !thisWeek) || params.to ? { k: 'dates', label: `${params.from || '…'} a ${params.to || 'hoy'}`, patch: { from: null, to: null } } : null,
    params.localidad_id && { k: 'geo', label: 'Ubicación', patch: { localidad_id: null, comuna_id: null, barrio_id: null } },
    params.geo_status && { k: 'geo_status', label: 'Ubicación por verificar', patch: { geo_status: null } },
    params.secure_vote && { k: 'sv', label: `Voto seguro: ${{ yes: 'Sí', no: 'No', unknown: 'Sin valorar' }[params.secure_vote]}`, patch: { secure_vote: null } },
    params.supports && { k: 'sup', label: `Contamos contigo: ${{ yes: 'Sí', no: 'No', unknown: 'Sin respuesta' }[params.supports]}`, patch: { supports: null } },
    params.reg_type_id && { k: 'rt', label: types.byId[params.reg_type_id]?.name || 'Tipo', patch: { reg_type_id: null } },
  ].filter(Boolean);

  const meta = (r) => {
    const team = !params.head_id ? (teams.name(r.head_id) || r.head_name) : null;
    const place = r.barrio_name || r.localidad_name;
    let m;
    if (r.is_head) m = `cabeza de ${CAMPAIGN}, ${nf.format(r.descendant_count)} en su equipo`;
    else if (r.is_leader) m = `líder, ${nf.format(r.descendant_count)} en su red`;
    else m = [r.inviter_name ? `con ${r.inviter_name}` : r.is_direct ? `con ${CAMPAIGN}` : null, place].filter(Boolean).join(', ') || 'Persona';
    const out = team && !r.is_head && !r.is_direct ? `${m}, equipo de ${team}` : m;
    return out.charAt(0).toUpperCase() + out.slice(1);
  };

  return (
    <Screen title="Personas" count={state.total !== null ? nf.format(state.total) : undefined}
      actions={<BarButton icon={UserPlus} label="Registrar persona" onClick={() => setSheet('register')} />}>
      <div className="m-search-inline">
        <Search size={18} aria-hidden="true" />
        <input data-tab-search className="input" type="search" enterKeyHint="search" placeholder="Nombre, cédula, celular o barrio"
          aria-label="Buscar personas" value={term} onChange={(e) => setTerm(e.target.value)} />
      </div>
      <Chips label="Filtros rápidos" className="m-quick-filters">
        {pendingN > 0 && <Chip warn onClick={() => go('/pendientes')}>Por aprobar <span className="m-chip__count">{pendingN}</span></Chip>}
        <Chip active={thisWeek} onClick={() => remove({ from: thisWeek ? null : weekStart(), to: null })}>Esta semana</Chip>
        <Chip active={onlyLeaders} onClick={() => remove({ type: onlyLeaders ? null : 'leader' })}>Líderes</Chip>
        <Chip icon={SlidersHorizontal} active={filterCount > 0} onClick={() => setSheet('filters')}>Filtros{filterCount ? ` ${filterCount}` : ''}</Chip>
      </Chips>
      {active.length > 0 && (
        <Chips label="Filtros activos" className="m-active-filters">
          {active.map((x) => <Chip key={x.k} onRemove={() => remove(x.patch)} removeLabel={`Quitar filtro: ${x.label}`}>{x.label}</Chip>)}
        </Chips>
      )}
      <div className="m-list-head">
        <span>{state.total === null ? 'Cargando…' : `${nf.format(state.total)} ${state.total === 1 ? 'persona' : 'personas'}`}</span>
        <button type="button" className="m-link-btn" onClick={() => setSheet('sort')}>{SORTS[sortKey(params)].label}<ChevronDown size={16} /></button>
      </div>

      {state.loading && !state.rows.length ? <RowsSkeleton rows={6} /> : state.rows.length ? (
        <Group>
          {state.rows.map((r) => (
            <Row key={r.id} to={`/personas/${r.id}`} lead={<PersonAvatar name={r.full_name} leader={r.is_leader} head={r.is_head} photo={r.photo_url} />}
              title={<>{r.full_name}<RoleIcon isHead={r.is_head} isLeader={r.is_leader} size={13} /></>}
              meta={r.status !== 'active' ? <><span className={`badge badge-${STATUS[r.status]?.tone || 'muted'}`}>{r.status === 'pending' ? 'Por aprobar' : STATUS[r.status]?.label}</span> {meta(r)}</> : meta(r)}
              trail={<small>{relTime(r.created_at)}</small>} chevron={false} />
          ))}
        </Group>
      ) : state.error ? (
        <EmptyState title="No se pudo cargar la lista" action={<button type="button" className="btn" onClick={() => load(1, { rows: [] })}>Reintentar</button>}>{state.error.message}</EmptyState>
      ) : params.q || active.length ? (
        <EmptyState icon={Users} title={params.q ? `Nadie coincide con «${params.q}»` : 'Nadie coincide con estos filtros'}
          action={<button type="button" className="btn" onClick={() => { setTerm(''); setParams(Object.fromEntries(['q', ...FILTER_KEYS].map((k) => [k, null])), true); }}>Limpiar filtros</button>}>
          Revise los filtros o busque por celular.
        </EmptyState>
      ) : <EmptyState icon={Users} title="Aún no hay personas registradas">Cuando alguien se registre, aparecerá aquí.</EmptyState>}
      <div ref={sentinel} aria-hidden="true" />
      {state.rows.length > 0 && state.rows.length < (state.total || 0) && <p className="m-hint" aria-busy="true">Cargando más…</p>}

      {sheet === 'filters' && <FiltersSheet params={params} onApply={(f) => setParams(f, true)} onClose={() => setSheet(null)} />}
      {sheet === 'sort' && (
        <ActionSheet title="Ordenar por" onClose={() => setSheet((s) => (s === 'sort' ? null : s))} groups={[Object.entries(SORTS).map(([k, s]) => ({
          label: `${s.label}${k === sortKey(params) ? '  ✓' : ''}`, onSelect: () => setParams({ sort: k === 'recientes' ? null : s.sort, dir: k === 'recientes' ? null : s.dir }, true),
        }))]} />
      )}
      {sheet === 'register' && <RegisterPersonModal onClose={() => setSheet(null)}
        onCreated={(p) => { lists.clear(); invalidate('counts:'); invalidate('dash'); go(`/personas/${p.id}`); }} />}
    </Screen>
  );
}
