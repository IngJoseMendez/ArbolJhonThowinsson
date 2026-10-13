import { q } from '../db.js';

export async function audit(user, action, entity, entityId, details = {}, ip = null) {
  await q('INSERT INTO audit_log (user_id, action, entity, entity_id, details, ip) VALUES (?, ?, ?, ?, ?, ?)')
    .run(user?.id ?? null, action, entity, entityId ?? null, JSON.stringify(details), ip);
}

export async function history(personId, changeType, details = {}, userId = null, reason = null) {
  await q('INSERT INTO person_history (person_id, change_type, details, reason, changed_by) VALUES (?, ?, ?, ?, ?)')
    .run(personId, changeType, JSON.stringify(details), reason, userId ?? null);
}
