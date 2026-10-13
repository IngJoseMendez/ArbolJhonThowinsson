import { q } from '../db.js';

export function audit(user, action, entity, entityId, details = {}, ip = null) {
  q('INSERT INTO audit_log (user_id, action, entity, entity_id, details, ip) VALUES (?, ?, ?, ?, ?, ?)')
    .run(user?.id ?? null, action, entity, entityId ?? null, JSON.stringify(details), ip);
}

export function history(personId, changeType, details = {}, userId = null, reason = null) {
  q('INSERT INTO person_history (person_id, change_type, details, reason, changed_by) VALUES (?, ?, ?, ?, ?)')
    .run(personId, changeType, JSON.stringify(details), reason, userId ?? null);
}
