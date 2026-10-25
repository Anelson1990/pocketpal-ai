import type {NotesStorage} from '../notes/NotesStorage';

/** Tool result when the Notes memory switch is off (e.g. flipped mid-run). */
export const NOTES_OFF_MESSAGE =
  'Notes memory is turned off, so nothing was saved or read. Tell the user they can turn it on in Settings → Notes memory.';

/**
 * Injected at `registerDefaultTalents()` so the engines never import the
 * store — same shape as SearchAccess.
 */
export interface NotesAccess {
  /** Enforced in execute(), not just in which tools are advertised. */
  isEnabled(): boolean;
  storage: NotesStorage;
}
