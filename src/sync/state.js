import { isValidSyncToken } from '../domain/lists.js';

export function createSyncState(saved = {}, list) {
  const unpublished = saved.unpublished ?? !list?.[0].online;
  const deletion = saved.deletePending ? 'pending' : saved.deleted ? 'deleted' : 'none';
  return {
    revision: isValidSyncToken(saved.revision) ? saved.revision : null,
    access: saved.access || null,
    pin: saved.pin || null,
    hasPin: !!saved.hasPin,
    pending: !!saved.pending,
    publication: unpublished ? (saved.attempted ? 'attempted' : 'local') : 'published',
    deletion,
    activity: 'idle',
    ready: false,
    error:
      deletion === 'pending'
        ? 'Deletion is not finished. Retry delete; your local copy has been kept.'
        : deletion === 'deleted'
          ? 'The online list was deleted. This copy is now local only.'
          : '',
    conflictRevision: null,
    missing: false,
  };
}

// Persist only the current token and durable flags, never transient requests or UI errors.
export function savedSyncState(state) {
  return {
    revision: state.revision,
    access: state.access,
    pin: state.pin,
    hasPin: state.hasPin,
    pending: state.pending,
    unpublished: state.publication !== 'published',
    attempted: state.publication !== 'local',
    deleted: state.deletion === 'deleted',
    deletePending: state.deletion === 'pending',
  };
}

export function hasRemoteCopy(state, list) {
  return state.deletion !== 'none' || state.publication !== 'local' || !!list?.[0].online;
}
