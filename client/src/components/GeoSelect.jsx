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

function useOptions(level, parent) {
  const [state, setState] = useState({ list: [], loading: false });
  const parentId = parent && !isManual(parent) ? parent.id : null;
  const enabled = level === 'localidad' || !!parentId;
  useEffect(() => {
    if (!enabled) { setState({ list: [], loading: false }); return; }
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    fetchAreas(level, parentId).then((list) => alive && setState({ list, loading: false }))
      .catch(() => alive && setState({ list: [], loading: false }));
    return () => { alive = false; };
  }, [level, parentId, enabled]);
  return state;
}

/** Texto legible de la ubicación ("Localidad 2 › Comuna 3 · Pescaíto › Olaya Herrera"). */
export function geoLabel(v) {
  return ['localidad', 'comuna', 'barrio'].map((l) => v?.[l]).filter(Boolean)
    .map((x) => (isManual(x) ? `${x.manual} (escrita)` : x.alias && x.kind === 'comuna' ? `${x.name} · ${x.alias}` : x.name));
}

/**
 * Selector geográfico dependiente Localidad → Comuna/Corregimiento → Barrio/Vereda.
 * mode="form": con opción "no está aquí" y resumen; mode="filter": sólo catálogo, compacto.
 */
export default function GeoSelect({ value = emptyGeo, onChange, errors = {}, mode = 'form', idPrefix = 'geo' }) {
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
