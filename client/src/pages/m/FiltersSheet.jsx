import { useEffect, useState } from 'react';
import { api, qs } from '../../api.js';
import { useRegTypes } from '../../lib/regTypes.js';
import { teamName, useTeams } from '../../lib/teams.js';
import Sheet from '../../components/m/Sheet.jsx';
import { Chip, Chips } from '../../components/m/List.jsx';
import GeoSelect, { emptyGeo, geoFromIds } from '../../components/GeoSelect.jsx';
import LeaderPicker from '../../components/LeaderPicker.jsx';

/** Los filtros de Personas: los mismos parámetros que la lista de escritorio. */
export const FILTER_KEYS = ['head_id', 'leader_id', 'inviter_id', 'type', 'status', 'method', 'from', 'to', 'localidad_id', 'comuna_id', 'barrio_id',
  'geo_status', 'secure_vote', 'supports', 'reg_type_id', 'mine'];

function Choice({ label, value, onChange, options }) {
  return (
    <fieldset className="m-filter">
      <legend>{label}</legend>
      <Chips label={label}>
        {options.map(([v, l]) => <Chip key={v || 'all'} active={(value || '') === v} onClick={() => onChange(v || null)}>{l}</Chip>)}
      </Chips>
    </fieldset>
  );
}

/** Hoja de filtros: edita una copia y, al confirmar, aplica todo junto. El botón dice cuántas personas coinciden. */
export default function FiltersSheet({ params, onApply, onClose }) {
  const teams = useTeams();
  const types = useRegTypes();
  const [f, setF] = useState(() => Object.fromEntries(FILTER_KEYS.map((k) => [k, params[k] || null])));
  const [geo, setGeo] = useState(emptyGeo);
  const [leaders, setLeaders] = useState(null);
  const [count, setCount] = useState(null);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v || null }));

  useEffect(() => { geoFromIds(params).then(setGeo).catch(() => {}); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let alive = true;
    api.get(`/leaders${qs({ head_id: f.head_id })}`).then((r) => alive && setLeaders(r)).catch(() => alive && setLeaders([]));
    return () => { alive = false; };
  }, [f.head_id]);
  // Cuántas personas coinciden con lo elegido (sin traerlas).
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      api.get(`/people${qs({ ...f, q: params.q, pageSize: 1 })}`).then((r) => alive && setCount(r.total)).catch(() => alive && setCount(null));
    }, 300);
    return () => { alive = false; clearTimeout(t); };
  }, [f, params.q]);

  const onGeo = (g) => {
    setGeo(g);
    setF((x) => ({ ...x, localidad_id: g.localidad?.id || null, comuna_id: g.comuna?.id || null, barrio_id: g.barrio?.id || null }));
  };
  const clear = () => { setF(Object.fromEntries(FILTER_KEYS.map((k) => [k, null]))); setGeo(emptyGeo); };
  const heads = teams.list.filter((h) => h.status === 'active');
  return (
    <Sheet title="Filtros" onClose={onClose} size="large"
      footer={({ close }) => (
        <>
          <button type="button" className="btn" onClick={clear}>Limpiar</button>
          <button type="button" className="btn btn-primary" onClick={() => { onApply(f); close(); }}>
            {count === null ? 'Ver personas' : `Ver ${new Intl.NumberFormat('es').format(count)} ${count === 1 ? 'persona' : 'personas'}`}
          </button>
        </>
      )}>
      <div className="stack m-filters">
        {heads.length > 1 && (
          <div className="field">
            <label htmlFor="ff-head">Cabeza</label>
            <select id="ff-head" className="select" value={f.head_id || ''} onChange={(e) => setF((x) => ({ ...x, head_id: e.target.value || null, leader_id: null }))}>
              <option value="">Todas</option>
              {heads.map((h) => <option key={h.id} value={h.id}>{teamName(h)}</option>)}
            </select>
          </div>
        )}
        <div className="field">
          <label htmlFor="ff-leader">Líder a cargo</label>
          <LeaderPicker id="ff-leader" leaders={leaders || []} loading={!leaders} compact placeholder="Cualquiera" showHead={!f.head_id}
            value={f.leader_id || ''} onChange={set('leader_id')} />
        </div>
        <Choice label="Quiénes" value={f.type} onChange={set('type')} options={[['', 'Todas'], ['head', 'Cabezas'], ['leader', 'Líderes'], ['person', 'Personas']]} />
        <Choice label="Estado" value={f.status} onChange={set('status')}
          options={[['', 'Vigentes'], ['active', 'Activas'], ['pending', 'Por aprobar'], ['inactive', 'Inactivas'], ['rejected', 'Rechazadas']]} />
        <Choice label="Cómo llegaron" value={f.method} onChange={set('method')} options={[['', 'Todas'], ['invitation', 'Por enlace'], ['manual', 'A mano']]} />
        <fieldset className="m-filter">
          <legend>Fecha de registro</legend>
          <div className="grid g-2" style={{ gap: 10 }}>
            <label className="field"><span className="small muted">Desde</span><input type="date" className="input" value={f.from || ''} onChange={(e) => set('from')(e.target.value)} /></label>
            <label className="field"><span className="small muted">Hasta</span><input type="date" className="input" value={f.to || ''} onChange={(e) => set('to')(e.target.value)} /></label>
          </div>
        </fieldset>
        <fieldset className="m-filter">
          <legend>Ubicación</legend>
          <GeoSelect mode="filter" idPrefix="ff" value={geo} onChange={onGeo} />
          <label className="check" style={{ marginTop: 10 }}>
            <input type="checkbox" checked={f.geo_status === 'pending'} onChange={(e) => set('geo_status')(e.target.checked ? 'pending' : null)} />
            <span>Sólo ubicaciones por verificar</span>
          </label>
        </fieldset>
        <Choice label="¿Es voto seguro?" value={f.secure_vote} onChange={set('secure_vote')} options={[['', 'Todos'], ['yes', 'Sí'], ['no', 'No'], ['unknown', 'Sin valorar']]} />
        <Choice label="¿Contamos contigo?" value={f.supports} onChange={set('supports')} options={[['', 'Todos'], ['yes', 'Sí'], ['no', 'No'], ['unknown', 'Sin respuesta']]} />
        {types.list.length > 0 && (
          <div className="field">
            <label htmlFor="ff-type">Tipo de registro</label>
            <select id="ff-type" className="select" value={f.reg_type_id || ''} onChange={(e) => set('reg_type_id')(e.target.value)}>
              <option value="">Cualquiera</option>
              {types.list.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        )}
      </div>
    </Sheet>
  );
}
