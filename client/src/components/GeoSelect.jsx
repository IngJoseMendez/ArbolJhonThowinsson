import { useEffect, useState } from 'react';
import { ChevronRight, MapPin, AlertTriangle } from 'lucide-react';
import { api, qs } from '../api.js';
import Combobox from './Combobox.jsx';

// Caché de opciones por nivel/padre (el catálogo cambia poco).
const cache = new Map();
export async function fetchAreas(level, parentId) {
  const key = `${level}:${parentId || ''}`;
  if (!cache.has(key)) {
    cache.set(key, api.get(`/geo/areas${qs({ level, parent_id: parentId })}`).catch((e) => { cache.delete(key); throw e; }));
  }
  return cache.get(key);
}
export const clearGeoCache = () => cache.clear();

/** Todos los barrios y veredas, con su comuna y su localidad (para elegir el barrio sin elegir antes la localidad). */
export async function fetchAllBarrios() {
  const key = 'barrios-todos';
  if (!cache.has(key)) cache.set(key, api.get('/geo/areas?level=barrio&todos=1').catch((e) => { cache.delete(key); throw e; }));
  return cache.get(key);
}

function useAllBarrios(enabled) {
  const [state, setState] = useState({ list: [], loading: false });
  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    fetchAllBarrios().then((list) => alive && setState({ list, loading: false })).catch(() => alive && setState({ list: [], loading: false }));
    return () => { alive = false; };
  }, [enabled]);
  return state;
}

/** Barrios y veredas de toda una localidad (formulario sin comuna), con su comuna o corregimiento. */
export async function fetchBarriosOfLocalidad(localidadId) {
  const key = `barrios-de:${localidadId}`;
  if (!cache.has(key)) {
    cache.set(key, api.get(`/geo/areas${qs({ level: 'barrio', localidad_id: localidadId })}`).catch((e) => { cache.delete(key); throw e; }));
  }
  return cache.get(key);
}

export const emptyGeo = { localidad: null, comuna: null, barrio: null };

/** Convierte la selección en el formato que espera la API. */
export function geoToApi(v) {
  const out = {};
  for (const level of ['localidad', 'comuna', 'barrio']) {
    const x = v?.[level];
    if (!x) continue;
    if (x.manual !== undefined) { if (x.manual.trim()) out[`${level}_text`] = x.manual.trim(); } else out[`${level}_id`] = x.id;
  }
  return out;
}

/** Convierte la ubicación devuelta por la API (ficha) en valor del selector. */
export function geoFromPerson(loc) {
  const conv = (x) => (!x ? null : x.manual !== undefined ? { manual: x.manual } : { id: x.id, name: x.name, alias: x.alias, kind: x.kind });
  return { localidad: conv(loc?.localidad), comuna: conv(loc?.comuna), barrio: conv(loc?.barrio) };
}

const isManual = (x) => x && x.manual !== undefined;

function useOptions(level, parent, { byLocalidad = false } = {}) {
  const [state, setState] = useState({ list: [], loading: false });
  const parentId = parent && !isManual(parent) ? parent.id : null;
  const enabled = level === 'localidad' || !!parentId;
  useEffect(() => {
    if (!enabled) { setState({ list: [], loading: false }); return; }
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    (byLocalidad ? fetchBarriosOfLocalidad(parentId) : fetchAreas(level, parentId)).then((list) => alive && setState({ list, loading: false }))
      .catch(() => alive && setState({ list: [], loading: false }));
    return () => { alive = false; };
  }, [level, parentId, enabled, byLocalidad]);
  return state;
}

/** Texto legible de la ubicación ("Localidad 2 › Comuna 3 · Pescaíto › Olaya Herrera"). */
export function geoLabel(v) {
  return ['localidad', 'comuna', 'barrio'].map((l) => v?.[l]).filter(Boolean)
    .map((x) => (isManual(x) ? `${x.manual} (escrita)` : x.alias && x.kind === 'comuna' ? `${x.name} · ${x.alias}` : x.name));
}

const describeBarrio = (o) => (o.parent_kind === 'corregimiento' ? `Vereda · Corregimiento ${o.parent_name}`
  : `${o.parent_name}${o.parent_alias ? ` · ${o.parent_alias}` : ''}`);

/**
 * Formulario de registro: sólo Localidad → Barrio/Vereda. La comuna o el corregimiento se deducen del barrio elegido
 * (se guardan igual, para filtros y conteos); si el barrio se escribe a mano queda pendiente de verificación.
 */
function SimpleGeoSelect({ value, onChange, errors, idPrefix }) {
  const loc = useOptions('localidad', null);
  const byLoc = useOptions('barrio', value.localidad, { byLocalidad: true });
  // Sin localidad elegida, el barrio se busca entre todos y la localidad se completa sola.
  const all = useAllBarrios(!value.localidad);
  const bar = value.localidad ? byLoc : all;
  const setLocalidad = (v) => {
    const same = v && value.localidad && !isManual(v) && v.id === value.localidad.id;
    onChange(same ? { ...value, localidad: v } : { localidad: v, comuna: null, barrio: null });
  };
  const setBarrio = (o) => {
    if (!o || isManual(o)) onChange({ ...value, comuna: null, barrio: o });
    else {
      const localidad = value.localidad || (o.localidad_id ? { id: o.localidad_id, name: o.localidad_name, alias: o.localidad_alias, kind: 'localidad' } : null);
      onChange({ localidad, comuna: { id: o.parent_id, name: o.parent_name, kind: o.parent_kind, alias: o.parent_alias }, barrio: o });
    }
  };
  const describe = (o) => (value.localidad ? describeBarrio(o) : `${describeBarrio(o)} · ${o.localidad_name}`);
  const upperManual = isManual(value.localidad);
  const path = [value.localidad, value.barrio].filter(Boolean).map((x) => (isManual(x) ? `${x.manual} (escrito)` : x.name));
  const pending = [value.localidad, value.barrio].some((x) => isManual(x) && x.manual.trim());
  return (
    <div className="geo-select stack">
      <div className="grid g-2 geo-grid" style={{ gap: 12 }}>
        <Combobox id={`${idPrefix}-localidad`} label="Localidad" required options={loc.list} loading={loc.loading} value={value.localidad}
          onChange={setLocalidad} placeholder="Buscar localidad…" error={errors.localidad}
          manualLabel="¿Tu localidad no está aquí? Escríbela" manualPlaceholder="Nombre de la localidad" />
        {upperManual ? (
          <div className="field">
            <label htmlFor={`${idPrefix}-barrio`}>Barrio o vereda <span className="muted">(opcional)</span></label>
            <input id={`${idPrefix}-barrio`} className={`input ${errors.barrio ? 'invalid' : ''}`} maxLength={120} placeholder="Si lo conoce, escríbalo"
              value={value.barrio?.manual || ''} onChange={(e) => setBarrio(e.target.value ? { manual: e.target.value } : null)} />
            {errors.barrio && <span className="err">{errors.barrio}</span>}
          </div>
        ) : (
          <Combobox id={`${idPrefix}-barrio`} label="Barrio o vereda" options={bar.list} loading={bar.loading} value={value.barrio}
            onChange={setBarrio} describe={describe} error={errors.barrio}
            placeholder="Buscar barrio o vereda…" hint={!value.localidad ? 'Si eliges el barrio, la localidad se completa sola.' : undefined}
            manualLabel="¿Tu barrio no está aquí? Escríbelo" manualPlaceholder="Nombre del barrio o vereda" />
        )}
      </div>
      {path.length > 0 && (
        <div className={`geo-summary ${pending ? 'pending' : ''}`} aria-live="polite">
          <MapPin size={15} />
          <span className="row-wrap" style={{ gap: 4 }}>
            {path.map((p, i) => <span key={i} className="row" style={{ gap: 4 }}>{i > 0 && <ChevronRight size={13} className="muted" />}{p}</span>)}
          </span>
          {pending && <span className="badge badge-warning"><AlertTriangle size={12} />Por verificar</span>}
          <button type="button" className="btn btn-sm btn-ghost" style={{ marginLeft: 'auto' }} onClick={() => onChange(emptyGeo)}>Corregir</button>
        </div>
      )}
    </div>
  );
}

/**
 * Selector geográfico dependiente Localidad → Comuna/Corregimiento → Barrio/Vereda.
 * mode="form": con opción "no está aquí" y resumen; mode="filter": sólo catálogo, compacto.
 * simple: formulario de registro con sólo Localidad y Barrio (la comuna se deduce).
 */
export default function GeoSelect({ simple, ...props }) {
  return simple ? <SimpleGeoSelect value={emptyGeo} errors={{}} idPrefix="geo" {...props} /> : <FullGeoSelect {...props} />;
}

function FullGeoSelect({ value = emptyGeo, onChange, errors = {}, mode = 'form', idPrefix = 'geo' }) {
  const form = mode === 'form';
  const loc = useOptions('localidad', null);
  const com = useOptions('comuna', value.localidad);
  const bar = useOptions('barrio', value.comuna);

  const setLocalidad = (v) => {
    const same = v && value.localidad && !isManual(v) && v.id === value.localidad.id;
    onChange(same ? { ...value, localidad: v } : { localidad: v, comuna: null, barrio: null });
  };
  const setComuna = (v) => {
    const same = v && value.comuna && !isManual(v) && v.id === value.comuna.id;
    onChange(same ? { ...value, comuna: v } : { ...value, comuna: v, barrio: null });
  };
  const setBarrio = (v) => onChange({ ...value, barrio: v });

  const rural = value.comuna?.kind === 'corregimiento';
  const upperManual = isManual(value.localidad);
  const comunaManual = upperManual || isManual(value.comuna);
  const labels = {
    comuna: 'Comuna o corregimiento',
    barrio: rural ? 'Vereda' : 'Barrio',
  };
  const path = geoLabel(value);
  const pending = ['localidad', 'comuna', 'barrio'].some((l) => isManual(value[l]) && value[l].manual.trim());

  const manualInput = (level, label, placeholder) => (
    <div className="field">
      <label htmlFor={`${idPrefix}-${level}`}>{label} <span className="muted">(opcional)</span></label>
      <input id={`${idPrefix}-${level}`} className={`input ${errors[level] ? 'invalid' : ''}`} maxLength={120} placeholder={placeholder}
        value={value[level]?.manual || ''} onChange={(e) => (level === 'comuna' ? setComuna : setBarrio)(e.target.value ? { manual: e.target.value } : null)} />
      {errors[level] && <span className="err">{errors[level]}</span>}
    </div>
  );

  return (
    <div className={form ? 'geo-select stack' : 'geo-filter'}>
      <div className={form ? 'grid g-3 geo-grid' : 'row-wrap'} style={form ? { gap: 12 } : undefined}>
        <Combobox id={`${idPrefix}-localidad`} label={form ? 'Localidad' : undefined} required={form} compact={!form}
          options={loc.list} loading={loc.loading} value={value.localidad} onChange={setLocalidad}
          placeholder={form ? 'Buscar localidad…' : 'Localidad'} error={errors.localidad}
          manualLabel={form ? '¿Tu localidad no está aquí? Escríbela' : undefined} manualPlaceholder="Nombre de la localidad" />
        {form && upperManual ? manualInput('comuna', 'Comuna o corregimiento', 'Si la conoce, escríbala') : (
          <Combobox id={`${idPrefix}-comuna`} label={form ? labels.comuna : undefined} compact={!form}
            options={com.list} loading={com.loading} value={value.comuna} onChange={setComuna}
            disabled={!value.localidad} placeholder={!value.localidad ? (form ? 'Elija primero la localidad' : 'Comuna') : form ? 'Buscar comuna o corregimiento…' : 'Comuna'}
            describe={(o) => (o.kind === 'corregimiento' ? 'Corregimiento (zona rural)' : o.alias)} error={errors.comuna}
            manualLabel={form ? '¿Tu comuna o corregimiento no está aquí? Escríbelo' : undefined} manualPlaceholder="Nombre de la comuna o corregimiento" />
        )}
        {form && comunaManual ? manualInput('barrio', labels.barrio, 'Si lo conoce, escríbalo') : (
          <Combobox id={`${idPrefix}-barrio`} label={form ? labels.barrio : undefined} compact={!form}
            options={bar.list} loading={bar.loading} value={value.barrio} onChange={setBarrio}
            disabled={!value.comuna} placeholder={!value.comuna ? (form ? 'Elija primero la comuna' : 'Barrio') : form ? `Buscar ${rural ? 'vereda' : 'barrio'}…` : 'Barrio'}
            error={errors.barrio}
            manualLabel={form ? `¿Tu ${rural ? 'vereda' : 'barrio'} no está aquí? Escríbelo` : undefined} manualPlaceholder={`Nombre del ${rural ? 'vereda' : 'barrio'}`} />
        )}
      </div>
      {form && path.length > 0 && (
        <div className={`geo-summary ${pending ? 'pending' : ''}`} aria-live="polite">
          <MapPin size={15} />
          <span className="row-wrap" style={{ gap: 4 }}>
            {path.map((p, i) => <span key={i} className="row" style={{ gap: 4 }}>{i > 0 && <ChevronRight size={13} className="muted" />}{p}</span>)}
          </span>
          {pending && <span className="badge badge-warning"><AlertTriangle size={12} />Por verificar</span>}
          <button type="button" className="btn btn-sm btn-ghost" style={{ marginLeft: 'auto' }} onClick={() => onChange(emptyGeo)}>Corregir</button>
        </div>
      )}
    </div>
  );
}

/** Reconstruye la selección a partir de identificadores (p. ej. desde la URL). */
export async function geoFromIds({ localidad_id, comuna_id, barrio_id }) {
  const out = { ...emptyGeo };
  if (!localidad_id) return out;
  out.localidad = (await fetchAreas('localidad')).find((a) => a.id === Number(localidad_id)) || null;
  if (!out.localidad || !comuna_id) return out;
  out.comuna = (await fetchAreas('comuna', out.localidad.id)).find((a) => a.id === Number(comuna_id)) || null;
  if (!out.comuna || !barrio_id) return out;
  out.barrio = (await fetchAreas('barrio', out.comuna.id)).find((a) => a.id === Number(barrio_id)) || null;
  return out;
}
