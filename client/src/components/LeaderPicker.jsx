import { useMemo } from 'react';
import Combobox from './Combobox.jsx';

/**
 * Selector de líder escribible: se busca por nombre o por código.
 * - leaders: filas de GET /leaders
 * - value: id del líder (número o texto) o '' / null
 * - onChange(id | '')
 */
export default function LeaderPicker({ leaders = [], value, onChange, placeholder = 'Escriba el nombre o código del líder…', exclude, showHead, loading, ...rest }) {
  const options = useMemo(() => (leaders || [])
    .filter((l) => l.id !== exclude)
    .map((l) => ({ id: l.id, name: l.full_name, alias: showHead && l.head_name ? `${l.leader_code} · ${l.head_name}` : l.leader_code })), [leaders, exclude, showHead]);
  const selected = value ? options.find((o) => o.id === Number(value)) || null : null;
  return (
    <Combobox options={options} value={selected} loading={loading} placeholder={placeholder}
      onChange={(o) => onChange(o ? String(o.id) : '')} {...rest} />
  );
}
