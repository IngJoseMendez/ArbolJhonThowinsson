import { CheckCircle2 } from 'lucide-react';
import GeoSelect, { emptyGeo, geoToApi } from './GeoSelect.jsx';
import {
  cedulaError, emailError, emailSuggestion, formatCedula, formatMobile, formatName, mobileError, normalizeCedula,
  normalizeEmail, normalizeMobile,
} from '../lib/validators.js';

export { normalizeMobile };
export const emptyPerson = { full_name: '', document_id: '', address: '', phone: '', email: '', geo: emptyGeo };

/** Validación en el cliente con las mismas reglas que el servidor. Devuelve { campo: mensaje }. */
export function validatePerson(v) {
  const e = {};
  if (String(v.full_name || '').trim().length < 3 || !/\p{L}{2,}/u.test(v.full_name || '')) e.full_name = 'Escriba el nombre completo.';
  const c = cedulaError(v.document_id); if (c) e.document_id = c;
  if (String(v.address || '').trim().length < 5) e.address = 'Escriba la dirección (calle, carrera, número…).';
  const m = mobileError(v.phone); if (m) e.phone = m;
  const em = emailError(v.email); if (em) e.email = em;
  const g = v.geo || emptyGeo;
  if (!g.localidad || (g.localidad.manual !== undefined && !g.localidad.manual.trim())) e.localidad = 'Seleccione o escriba la localidad.';
  if (g.comuna?.manual !== undefined && !g.comuna.manual.trim() && g.localidad?.manual === undefined) e.comuna = 'Escriba la comuna o vuelva al listado.';
  if (g.barrio?.manual !== undefined && !g.barrio.manual.trim() && g.comuna?.manual === undefined && g.localidad?.manual === undefined) e.barrio = 'Escriba el barrio o vuelva al listado.';
  return e;
}

export function personPayload(v) {
  return {
    full_name: formatName(v.full_name), document_id: normalizeCedula(v.document_id), address: v.address.trim().replace(/\s+/g, ' '),
    phone: normalizeMobile(v.phone), email: normalizeEmail(v.email) || null, location: geoToApi(v.geo),
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
 * correo en minúsculas sin espacios, nombre en mayúscula inicial. Teclado numérico en celular.
 */
export default function PersonFields({ value, onChange, errors = {}, onBlurField, size, idPrefix = 'pf' }) {
  const setRaw = (k, v) => onChange({ ...value, [k]: v });
  const blur = (k) => () => {
    if (k === 'full_name' && value.full_name) setRaw('full_name', formatName(value.full_name));
    onBlurField?.(k);
  };
  const live = {
    phone: value.phone && normalizeMobile(value.phone).length === 10 ? mobileError(value.phone) : null,
    document_id: value.document_id && normalizeCedula(value.document_id).length >= 8 ? cedulaError(value.document_id) : null,
  };
  const err = (k) => errors[k] || live[k] || null;
  const ok = (k) => !err(k) && ((k === 'phone' && !mobileError(value.phone)) || (k === 'document_id' && !cedulaError(value.document_id)));
  const suggestion = emailSuggestion(value.email);

  const F = ({ k, label, children, hint, optional }) => (
    <div className={`field ${size === 'lg' ? 'field-lg' : ''}`}>
      <label htmlFor={`${idPrefix}-${k}`}>{label}{optional ? <span className="muted"> (opcional)</span> : <span className="req"> *</span>}</label>
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
      {F({
        k: 'full_name', label: 'Nombre completo',
        children: <input {...common('full_name')} value={value.full_name} onChange={(e) => setRaw('full_name', e.target.value)}
          maxLength={120} autoComplete="name" autoCapitalize="words" placeholder="Nombres y apellidos" />,
      })}
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
      <GeoSelect idPrefix={`${idPrefix}-geo`} value={value.geo} onChange={(geo) => onChange({ ...value, geo })} errors={errors} />
      {F({
        k: 'email', label: 'Correo electrónico', optional: true,
        children: <input {...common('email')} type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false}
          value={value.email} onChange={(e) => setRaw('email', normalizeEmail(e.target.value))} placeholder="nombre@gmail.com" maxLength={160} />,
      })}
      {suggestion && (
        <button type="button" className="alert alert-warn email-suggest" onClick={() => setRaw('email', suggestion)}>
          ¿Quiso decir <b>{suggestion}</b>? Toque para corregir.
        </button>
      )}
    </div>
  );
}
