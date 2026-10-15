import { CheckCircle2 } from 'lucide-react';
import GeoSelect, { emptyGeo, geoToApi } from './GeoSelect.jsx';
import { Mark, SLOGAN } from '../brand/Brand.jsx';
import { cedulaError, formatCedula, formatMobile, formatName, mobileError, normalizeCedula, normalizeMobile } from '../lib/validators.js';

export { normalizeMobile };
export const emptyPerson = { first_names: '', last_names: '', document_id: '', address: '', phone: '', geo: emptyGeo, supports: '', secure_vote: '' };

/**
 * Pregunta final del formulario:
 * - registro por enlace: la persona responde «¿Contamos contigo en este camino?» (supports);
 * - registro manual: quien registra (administrador, político) valora «¿Es voto seguro?» (secure_vote).
 */
const QUESTION = {
  supports: { label: '¿Contamos contigo en este camino?', error: 'Elija Sí o No.' },
  secure_vote: { label: '¿Es voto seguro?', error: 'Indique si es voto seguro.' },
};
const questionKey = (assessment) => (assessment ? 'secure_vote' : 'supports');

const nameError = (v, what) => {
  const x = String(v || '').trim();
  if (!x) return `Escriba ${what}.`;
  if (!/^[\p{L}' .-]+$/u.test(x) || (x.match(/\p{L}/gu) || []).length < 2) return `Escriba ${what} sólo con letras.`;
  return null;
};

/** Validación en el cliente con las mismas reglas que el servidor. Devuelve { campo: mensaje }. */
export function validatePerson(v, { assessment = false } = {}) {
  const e = {};
  const fn = nameError(v.first_names, 'los nombres'); if (fn) e.first_names = fn;
  const ln = nameError(v.last_names, 'los apellidos'); if (ln) e.last_names = ln;
  const c = cedulaError(v.document_id); if (c) e.document_id = c;
  if (String(v.address || '').trim().length < 5) e.address = 'Escriba la dirección (calle, carrera, número…).';
  const m = mobileError(v.phone); if (m) e.phone = m;
  const g = v.geo || emptyGeo;
  if (!g.localidad || (g.localidad.manual !== undefined && !g.localidad.manual.trim())) e.localidad = 'Seleccione o escriba la localidad.';
  if (g.barrio?.manual !== undefined && !g.barrio.manual.trim() && g.localidad?.manual === undefined) e.barrio = 'Escriba el barrio o vuelva al listado.';
  const qk = questionKey(assessment);
  if (v[qk] !== 'yes' && v[qk] !== 'no') e[qk] = QUESTION[qk].error;
  return e;
}

export const personName = (v) => `${formatName(v.first_names)} ${formatName(v.last_names)}`.trim();

export function personPayload(v) {
  return {
    first_names: formatName(v.first_names), last_names: formatName(v.last_names), document_id: normalizeCedula(v.document_id),
    address: v.address.trim().replace(/\s+/g, ' '), phone: normalizeMobile(v.phone), location: geoToApi(v.geo),
    ...(v.supports ? { supports: v.supports } : {}), ...(v.secure_vote ? { secure_vote: v.secure_vote } : {}),
  };
}

/** Mapea el error del servidor ({ field }) al campo del formulario. */
export const serverFieldError = (err) => {
  if (!err?.field) return {};
  const f = err.field === 'nombre completo' ? 'full_name' : err.field;
  return { [f]: err.message };
};

/**
 * Campos de persona (idénticos en registro manual y por enlace).
 * Formatean automáticamente lo que se escribe o pega: celular "300 555 0123", cédula "1.082.345.678",
 * nombres y apellidos con mayúscula inicial. Teclado numérico en celular y cédula.
 * slogan: muestra el eslogan bajo la pregunta final (formulario público).
 * assessment: registro manual; la pregunta final es «¿Es voto seguro?» (la responde quien registra).
 */
export default function PersonFields({ value, onChange, errors = {}, onBlurField, size, idPrefix = 'pf', slogan, assessment }) {
  const qk = questionKey(assessment);
  const setRaw = (k, v) => onChange({ ...value, [k]: v });
  const blur = (k) => () => {
    if ((k === 'first_names' || k === 'last_names') && value[k]) setRaw(k, formatName(value[k]));
    onBlurField?.(k);
  };
  const live = {
    phone: value.phone && normalizeMobile(value.phone).length === 10 ? mobileError(value.phone) : null,
    document_id: value.document_id && normalizeCedula(value.document_id).length >= 8 ? cedulaError(value.document_id) : null,
  };
  const err = (k) => errors[k] || live[k] || null;
  const ok = (k) => !err(k) && ((k === 'phone' && !mobileError(value.phone)) || (k === 'document_id' && !cedulaError(value.document_id)));

  const F = ({ k, label, children, hint }) => (
    <div className={`field ${size === 'lg' ? 'field-lg' : ''}`}>
      <label htmlFor={`${idPrefix}-${k}`}>{label}<span className="req"> *</span></label>
      <div className="input-wrap">
        {children}
        {ok(k) && <CheckCircle2 size={16} className="input-ok" aria-label="Formato válido" />}
      </div>
      {hint && !err(k) && <span className="hint">{hint}</span>}
      {err(k) && <span className="err" id={`${idPrefix}-${k}-err`} role="alert">{err(k)}</span>}
    </div>
  );
  const common = (k) => ({
    id: `${idPrefix}-${k}`, className: `input ${err(k) ? 'invalid' : ''}`, onBlur: blur(k),
    'aria-invalid': !!err(k) || undefined, 'aria-describedby': err(k) ? `${idPrefix}-${k}-err` : undefined,
  });

  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="grid g-2" style={{ gap: 14 }}>
        {F({
          k: 'first_names', label: 'Nombres',
          children: <input {...common('first_names')} value={value.first_names} onChange={(e) => setRaw('first_names', e.target.value)}
            maxLength={60} autoComplete="given-name" autoCapitalize="words" placeholder="Ej.: María José" />,
        })}
        {F({
          k: 'last_names', label: 'Apellidos',
          children: <input {...common('last_names')} value={value.last_names} onChange={(e) => setRaw('last_names', e.target.value)}
            maxLength={60} autoComplete="family-name" autoCapitalize="words" placeholder="Ej.: Pérez Gómez" />,
        })}
      </div>
      <div className="grid g-2" style={{ gap: 14 }}>
        {F({
          k: 'document_id', label: 'Cédula', hint: 'Sólo números. Evita registros duplicados.',
          children: <input {...common('document_id')} value={formatCedula(value.document_id)}
            onChange={(e) => setRaw('document_id', normalizeCedula(e.target.value))}
            inputMode="numeric" pattern="[0-9.]*" autoComplete="off" placeholder="1.082.345.678" maxLength={13} />,
        })}
        {F({
          k: 'phone', label: 'Celular / WhatsApp', hint: 'Puede pegarlo con +57: se ajusta solo.',
          children: <input {...common('phone')} type="tel" value={formatMobile(value.phone)}
            onChange={(e) => setRaw('phone', normalizeMobile(e.target.value))}
            onPaste={(e) => { e.preventDefault(); setRaw('phone', normalizeMobile(e.clipboardData.getData('text'))); }}
            inputMode="numeric" autoComplete="tel-national" placeholder="300 555 0123" maxLength={12} />,
        })}
      </div>
      {F({
        k: 'address', label: 'Dirección',
        children: <input {...common('address')} value={value.address} onChange={(e) => setRaw('address', e.target.value)}
          autoComplete="street-address" placeholder="Calle 10 # 5-20, apto 3" maxLength={200} />,
      })}
      <GeoSelect simple idPrefix={`${idPrefix}-geo`} value={value.geo} onChange={(geo) => onChange({ ...value, geo })} errors={errors} />
      <fieldset className={`supports ${errors[qk] ? 'invalid' : ''}`} aria-describedby={errors[qk] ? `${idPrefix}-${qk}-err` : undefined}>
        <legend>{QUESTION[qk].label}<span className="req"> *</span></legend>
        {/* «Sí» es la respuesta que invitamos a dar: más grande y con la marca; «No» queda discreto. */}
        <div className="supports-options" role="radiogroup">
          {[['yes', 'Sí'], ['no', 'No']].map(([v, l]) => (
            <label key={v} className={`supports-option is-${v} ${value[qk] === v ? 'active' : ''}`}>
              <input type="radio" name={`${idPrefix}-${qk}`} id={`${idPrefix}-${qk}-${v}`} value={v} checked={value[qk] === v}
                onChange={() => setRaw(qk, v)} />
              {v === 'yes' && <Mark size={20} />}
              {l}
            </label>
          ))}
        </div>
        {errors[qk] && <span className="err" id={`${idPrefix}-${qk}-err`} role="alert">{errors[qk]}</span>}
        {slogan && <p className="slogan">{SLOGAN}</p>}
      </fieldset>
    </div>
  );
}
