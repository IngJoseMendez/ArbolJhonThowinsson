import { useEffect, useMemo, useRef, useState } from 'react';
import { Link2, Search, SlidersHorizontal } from 'lucide-react';
import { api, qs } from '../../api.js';
import { invalidate } from '../../lib/cache.js';
import { haptic } from '../../lib/device.js';
import { forgetInvite } from '../../lib/invites.js';
import { useQueryState } from '../../lib/useParams.js';
import { useRegTypes } from '../../lib/regTypes.js';
import { teamName, useTeams } from '../../lib/teams.js';
import Screen from '../../components/m/Screen.jsx';
import Sheet from '../../components/m/Sheet.jsx';
import { Chip, Chips, EmptyState, Group, RowsSkeleton, Segmented } from '../../components/m/List.jsx';
import { LinkRow } from '../../components/invite/LinkRows.jsx';
import { useToast } from '../../components/ui.jsx';
import { LimitsModal } from '../Links.jsx';

const PAGE = 30;
const STATES = {
  'sin-usar': { label: 'Sin usar', query: { one_time: 1, state: 'open' } },
  usadas: { label: 'Usadas', query: { one_time: 1, state: 'used' } },
  generales: { label: 'Generales', query: { general: 1 } },
  todas: { label: 'Todas', query: {} },
};

/** Enlaces e invitaciones en tarjetas: sin usar (las que vencen antes primero), usadas, generales o todas. */
export default function Links() {
  const toast = useToast();
  const teams = useTeams();
  const types = useRegTypes();
  const [params, setParams] = useQueryState();
  const estado = STATES[params.estado] ? params.estado : 'sin-usar';
  const [term, setTerm] = useState(params.q || '');
  const [sheet, setSheet] = useState(null);
  const [limits, setLimits] = useState(null);
  const query = useMemo(() => ({ ...STATES[estado].query, reg_type_id: params.tipo, head_id: params.cabeza, q: params.q }), [estado, params.tipo, params.cabeza, params.q]);
  const key = JSON.stringify(query);
  const [state, setState] = useState({ rows: [], total: null, page: 0, loading: true });
  const busy = useRef(null);
  const gen = useRef(0);
  const sentinel = useRef(null);

  useEffect(() => {
    const t = setTimeout(() => { if ((params.q || '') !== term && (term.length >= 2 || !term)) setParams({ q: term || null }, true); }, 300);
    return () => clearTimeout(t);
  }, [term]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cada carga es de una vuelta: si mientras tanto se empezó otra (cambió el estado, la búsqueda o se actualizó), su
  // respuesta se descarta.
  const load = async (page, base) => {
    if (busy.current) return;
    const mine = { gen: gen.current };
    busy.current = mine;
    try {
      const r = await api.get(`/links${qs({ ...query, page, pageSize: PAGE })}`);
      if (gen.current === mine.gen) setState({ rows: page === 1 ? r.rows : [...base.rows, ...r.rows], total: r.total, page, loading: false, error: null });
    } catch (e) {
      if (gen.current === mine.gen) setState((s) => ({ ...s, loading: false, error: e }));
    } finally { if (busy.current === mine) busy.current = null; }
  };
  const reloadAll = () => { gen.current++; busy.current = null; setState({ rows: [], total: null, page: 0, loading: true }); load(1, { rows: [] }); };
  useEffect(() => { reloadAll(); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    window.addEventListener('m-refresh', reloadAll);
    return () => window.removeEventListener('m-refresh', reloadAll);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return undefined;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !busy.current && state.total !== null && state.rows.length < state.total) load(state.page + 1, state);
    }, { rootMargin: '600px 0px' });
    io.observe(el);
    return () => io.disconnect();
  });

  const type = params.tipo ? types.byId[params.tipo] : null;
  const head = params.cabeza ? teams.byId.get(Number(params.cabeza)) : null;
  const filters = (params.tipo ? 1 : 0) + (params.cabeza ? 1 : 0);
  // «Anular las sin usar» sólo con un tipo de cabeza o de líder (y su cabeza) elegidos: así se sabe qué se anula.
  const canRevoke = estado === 'sin-usar' && type && type.role !== 'person' && (type.role === 'head' || head) && state.total > 0;

  return (
    <Screen title="Enlaces" back="/invitar"
      actions={<button type="button" className="m-icon-btn on-navy" aria-label={`Filtros${filters ? `, ${filters} activos` : ''}`} onClick={() => setSheet('filters')}>
        <SlidersHorizontal size={21} />{filters > 0 && <span className="m-badge">{filters}</span>}
      </button>}>
      <Segmented sticky label="Estado" value={estado} onChange={(v) => setParams({ estado: v === 'sin-usar' ? null : v }, true)}
        options={Object.entries(STATES).map(([value, s]) => ({ value, label: s.label }))} />
      <div className="m-search-inline">
        <Search size={18} aria-hidden="true" />
        <input className="input" type="search" enterKeyHint="search" placeholder="Nombre, código o etiqueta" aria-label="Buscar enlaces" value={term} onChange={(e) => setTerm(e.target.value)} />
      </div>
      {(type || head) && (
        <Chips label="Filtros activos" className="m-active-filters">
          {type && <Chip onRemove={() => setParams({ tipo: null }, true)} removeLabel="Quitar tipo">{type.name}</Chip>}
          {head && <Chip onRemove={() => setParams({ cabeza: null }, true)} removeLabel="Quitar cabeza">{teamName(head)}</Chip>}
        </Chips>
      )}
      {canRevoke && (
        <div className="m-list-head">
          <span>{type.role === 'head' ? 'Invitaciones de cabeza' : `Líderes con ${teamName(head)}`}</span>
          <button type="button" className="m-link-btn danger" onClick={() => setSheet('revoke')}>{state.total === 1 ? 'Anular la que está sin usar' : `Anular las ${state.total} sin usar`}</button>
        </div>
      )}
      {state.loading && !state.rows.length ? <RowsSkeleton rows={5} /> : state.error && !state.rows.length ? (
        <EmptyState icon={Link2} title="No se pudieron cargar los enlaces"
          action={<button type="button" className="btn" onClick={reloadAll}>Reintentar</button>}>{state.error.message}</EmptyState>
      ) : state.rows.length ? (
        <Group className="m-links">{state.rows.map((l) => <LinkRow key={l.id} link={l} onLimits={setLimits} onChanged={reloadAll} />)}</Group>
      ) : (
        <EmptyState icon={Link2} title={estado === 'sin-usar' ? 'Nada sin usar' : estado === 'usadas' ? 'Aún no se ha usado ninguna' : 'No hay enlaces'}>
          {estado === 'sin-usar' ? 'Todas las invitaciones enviadas ya se usaron o se anularon.' : 'Pruebe con otro estado o quite los filtros.'}
        </EmptyState>
      )}
      <div ref={sentinel} aria-hidden="true" />
      {state.rows.length > 0 && state.rows.length < (state.total || 0) && <p className="m-hint">Cargando más…</p>}

      {sheet === 'filters' && (
        <Sheet title="Filtros" onClose={() => setSheet(null)}
          footer={({ close }) => <button type="button" className="btn" onClick={() => { setParams({ tipo: null, cabeza: null }, true); close(); }}>Limpiar</button>}>
          <div className="stack">
            <fieldset className="m-filter"><legend>Tipo de registro</legend>
              <Chips label="Tipo de registro">
                <Chip active={!params.tipo} onClick={() => setParams({ tipo: null }, true)}>Todos</Chip>
                {types.list.map((t) => <Chip key={t.id} active={String(t.id) === String(params.tipo)} onClick={() => setParams({ tipo: t.id }, true)}>{t.name}</Chip>)}
              </Chips>
            </fieldset>
            <fieldset className="m-filter"><legend>Cabeza</legend>
              <Chips label="Cabeza">
                <Chip active={!params.cabeza} onClick={() => setParams({ cabeza: null }, true)}>Todas</Chip>
                {teams.active.map((h) => <Chip key={h.id} active={String(h.id) === String(params.cabeza)} onClick={() => setParams({ cabeza: h.id }, true)}>{teamName(h)}</Chip>)}
              </Chips>
            </fieldset>
          </div>
        </Sheet>
      )}
      {sheet === 'revoke' && (
        <Sheet title={state.total === 1 ? '¿Anular la invitación sin usar?' : `¿Anular las ${state.total} invitaciones sin usar?`} onClose={() => setSheet(null)}
          subtitle={type.role === 'leader' && head?.cabeza_name
            ? `Dejarán de funcionar de inmediato, también las que ${head.cabeza_name.split(' ')[0]} envió desde su panel. Hágalo si alguna llegó a quien no debía.`
            : 'Dejarán de funcionar de inmediato. Hágalo si alguna llegó a quien no debía.'}
          footer={({ close }) => <>
            <button type="button" className="btn" onClick={close}>Cancelar</button>
            <button type="button" className="btn btn-danger" onClick={async () => {
              try {
                const headId = type.role === 'head' ? null : head.id;
                const r = await api.post('/links/one-time/revoke-open', { reg_type_id: type.id, head_id: headId });
                // La invitación preparada en este celular también quedó anulada: se prepara otra.
                forgetInvite(type.id, headId);
                haptic('warning'); invalidate('links:'); toast(`${r.revoked} ${r.revoked === 1 ? 'invitación anulada' : 'invitaciones anuladas'}.`); reloadAll();
              } catch (e) { toast(e.message, 'error'); }
              close();
            }}>{state.total === 1 ? 'Anularla' : `Anular las ${state.total}`}</button>
          </>}>
          <p className="m-note">Las personas que ya se registraron no cambian. Para invitar de nuevo, envíe invitaciones nuevas.</p>
        </Sheet>
      )}
      {limits && <LimitsModal link={limits} onClose={() => setLimits(null)} onDone={(m) => { toast(m); reloadAll(); }} />}
    </Screen>
  );
}
