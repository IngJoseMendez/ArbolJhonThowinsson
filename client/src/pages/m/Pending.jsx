import { useState } from 'react';
import { CheckCircle2, ClipboardCheck, XCircle } from 'lucide-react';
import { api } from '../../api.js';
import { useCached, invalidate } from '../../lib/cache.js';
import { haptic } from '../../lib/device.js';
import { phoneDisplay, relTime } from '../../lib/format.js';
import { useGo } from '../../lib/nav.js';
import { useTeams } from '../../lib/teams.js';
import { normalizePhone57 } from '../../lib/whatsapp.js';
import Screen from '../../components/m/Screen.jsx';
import Sheet from '../../components/m/Sheet.jsx';
import { EmptyState, RowsSkeleton } from '../../components/m/List.jsx';
import { ReasonSheet } from '../../components/invite/LinkRows.jsx';
import { useToast } from '../../components/ui.jsx';

/** Por aprobar: una tarjeta por registro con «Aprobar» a un toque y «Rechazar» con motivo. */
export default function Pending() {
  const go = useGo();
  const toast = useToast();
  const teams = useTeams();
  const list = useCached('pending:list', () => api.get('/pending'), { ttl: 15000 });
  const [gone, setGone] = useState({}); // id -> 'leaving'
  const [errors, setErrors] = useState({});
  const [reject, setReject] = useState(null);
  const [all, setAll] = useState(null); // { done, total, failed } mientras se aprueban todos
  const rows = (list.data || []).filter((p) => gone[p.id] !== 'gone');
  const refresh = () => { invalidate('counts:'); invalidate('dash'); invalidate('heads'); invalidate('person:'); };

  // La tarjeta se va con su animación y sale también de la lista guardada: al volver a la pantalla no reaparece.
  const leave = (id) => {
    setGone((g) => ({ ...g, [id]: 'leaving' }));
    setTimeout(() => {
      setGone((g) => ({ ...g, [id]: 'gone' }));
      list.mutate((cur) => (cur || []).filter((r) => r.id !== id));
    }, 230);
  };
  const approve = async (p) => {
    setErrors((e) => ({ ...e, [p.id]: null }));
    try {
      await api.post(`/people/${p.id}/status`, { status: 'active' });
      haptic('success');
      leave(p.id);
      toast(`Registro de ${p.full_name.split(' ')[0]} aprobado.`);
      refresh();
      return true;
    } catch (ex) { setErrors((e) => ({ ...e, [p.id]: ex.message })); return false; }
  };
  const approveAll = async () => {
    const todo = rows.filter((p) => !gone[p.id]);
    setAll({ done: 0, total: todo.length, failed: 0 });
    let failed = 0;
    for (let i = 0; i < todo.length; i++) {
      if (!(await approve(todo[i]))) failed++;
      setAll({ done: i + 1, total: todo.length, failed });
    }
    const ok = todo.length - failed;
    const okText = `${ok} ${ok === 1 ? 'aprobado' : 'aprobados'}`;
    toast(failed
      ? `${okText}; ${failed} ${failed === 1 ? 'con error (sigue en la lista)' : 'con errores (siguen en la lista)'}.`
      : `${ok} ${ok === 1 ? 'registro aprobado' : 'registros aprobados'}.`, failed ? 'error' : 'ok');
    setAll(null);
  };

  return (
    <Screen title="Por aprobar" count={rows.length || undefined} back="/personas"
      actions={rows.length >= 2 && <button type="button" className="m-bar__text-btn" onClick={() => setAll({ confirm: true })}>Aprobar todos</button>}>
      {list.loading ? <RowsSkeleton rows={3} /> : rows.length ? (
        <div className="m-pending-list">
          {rows.map((p) => {
            const team = teams.label(p.head_id) || p.head_name;
            const call = normalizePhone57(p.phone);
            return (
              <article key={p.id} className={`card m-card-pending ${gone[p.id] === 'leaving' ? 'is-leaving' : ''}`} aria-label={p.full_name}>
                <div className="m-card-pending__head">
                  <button type="button" className="m-card-pending__name" onClick={() => go(`/personas/${p.id}`)}>{p.full_name}</button>
                  <span className="m-card-pending__time">{relTime(p.created_at)}</span>
                </div>
                <p className="m-card-pending__meta">
                  {call ? <a href={`tel:+${call}`}>{phoneDisplay(p.phone)}</a> : phoneDisplay(p.phone)}{p.city ? `, ${p.city}` : ''}
                </p>
                <p className="m-card-pending__meta">{p.inviter_name ? `Llegó con ${p.inviter_name}` : 'Registro directo'}</p>
                <p className="m-card-pending__meta">{team}</p>
                {errors[p.id] && <div className="alert alert-error" role="alert">{errors[p.id]}</div>}
                <div className="m-card-pending__actions">
                  <button type="button" className="btn" onClick={() => setReject(p)}><XCircle size={17} />Rechazar</button>
                  <button type="button" className="btn btn-primary" onClick={() => approve(p)} disabled={!!all}><CheckCircle2 size={17} />Aprobar</button>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <EmptyState icon={ClipboardCheck} title="Nada por aprobar">Aquí llegan los registros de los equipos que piden aprobación.</EmptyState>
      )}
      {reject && <ReasonSheet title={`Rechazar a ${reject.full_name.split(' ')[0]}`} confirmLabel="Rechazar registro"
        reasons={['Registro duplicado', 'Datos incorrectos', 'No es de la zona', 'Otro motivo']}
        onConfirm={async (reason) => { await api.post(`/people/${reject.id}/status`, { status: 'rejected', reason }); leave(reject.id); toast('Registro rechazado.'); refresh(); }}
        onClose={() => setReject(null)} />}
      {all?.confirm && (
        <Sheet title={`¿Aprobar los ${rows.length} registros?`} subtitle="Quedarán activos en sus equipos y recibirán su invitación personal." onClose={() => setAll(null)}
          footer={({ close }) => <>
            <button type="button" className="btn" onClick={close}>Cancelar</button>
            <button type="button" className="btn btn-primary" onClick={() => { setAll(null); approveAll(); }}>Aprobar los {rows.length}</button>
          </>}>
          <p className="m-note">Si alguno tiene un problema (por ejemplo, un celular repetido), se queda en la lista con el aviso.</p>
        </Sheet>
      )}
      {all && !all.confirm && <div className="m-progress" role="status">Aprobando {all.done} de {all.total}…</div>}
    </Screen>
  );
}
