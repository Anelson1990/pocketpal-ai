import {RenderHtmlEngine} from './RenderHtmlEngine';
import {CalculateEngine} from './CalculateEngine';
import {DatetimeEngine} from './DatetimeEngine';
import {WebSearchEngine} from './WebSearchEngine';
import {ReadUrlEngine} from './ReadUrlEngine';
import {
  ReadNoteEngine,
  SaveNoteEngine,
  SearchNotesEngine,
} from './NotesEngines';
import {talentRegistry} from './TalentRegistry';
import type {SearchAccess} from './searchAccess';
import type {NotesAccess} from './notesAccess';
import {INTERNET_OFF_PROMPT} from './searchAccess';
import type {ToolDefinition, SystemPromptContext} from './types';
import {searchProviderStore} from '../../store/SearchProviderStore';
import {notesStore} from '../../store/NotesStore';
import {createSearchProvider, readWithDefaultReader} from '../search';

export {TalentRegistry, talentRegistry} from './TalentRegistry';
export {TalentUIRegistry, talentUIRegistry} from './TalentUIRegistry';
export type {TalentUI} from './TalentUIRegistry';
export {RenderHtmlEngine} from './RenderHtmlEngine';
export {CalculateEngine} from './CalculateEngine';
export {DatetimeEngine} from './DatetimeEngine';
export {WebSearchEngine} from './WebSearchEngine';
export {ReadUrlEngine} from './ReadUrlEngine';
export {
  ReadNoteEngine,
  SaveNoteEngine,
  SearchNotesEngine,
} from './NotesEngines';
export type {NotesAccess} from './notesAccess';
export {NOTES_OFF_MESSAGE} from './notesAccess';
export type {SearchAccess} from './searchAccess';
export {
  INTERNET_OFF_MESSAGE,
  INTERNET_OFF_PROMPT,
  SEARCH_NOT_SET_UP_MESSAGE,
} from './searchAccess';
// Deliberately narrow: the raw allowlist writers stay module-internal so all
// writes happen inside services/talents (seed at run start, WebSearchEngine
// per search, ReadUrlEngine per page read).
export {seedReadUrlAllowlist, isReadUrlAllowed} from './readUrlAllowlist';
export type {
  TalentEngine,
  TalentResult,
  ToolDefinition,
  SystemPromptContext,
} from './types';

/**
 * The single place that imports the store, so the search engines stay
 * store-free and pure.
 */
function createSearchAccess(): SearchAccess {
  return {
    getActiveProvider: () => {
      const id = searchProviderStore.activeProviderId;
      return createSearchProvider(id, () => searchProviderStore.getKey(id));
    },
    canSearch: () => searchProviderStore.canSearch,
    isInternetOn: () => searchProviderStore.isInternetOn,
    getResultCount: () => searchProviderStore.resultCount,
    readWithDefaultReader,
  };
}

function createNotesAccess(): NotesAccess {
  return {
    isEnabled: () => notesStore.enabled,
    storage: notesStore.storage,
  };
}

/** Talents that read or write the user's private notes. */
export const NOTES_TALENT_NAMES: readonly string[] = [
  'save_note',
  'search_notes',
  'read_note',
];

const isNotesTalent = (name: string): boolean =>
  NOTES_TALENT_NAMES.includes(name);

/** Talents that make requests to the internet on the model's behalf. */
export const INTERNET_TALENT_NAMES: readonly string[] = [
  'web_search',
  'read_url',
];

const isInternetTalent = (name: string): boolean =>
  INTERNET_TALENT_NAMES.includes(name);

/**
 * The talents a request may use: the Pal's own, with the internet ones gated by
 * the Internet toggle. ON adds web_search/read_url for any chat (Pal or not);
 * OFF removes them even if the Pal declares them. Tool schemas and the run's
 * allowlist both come from here so they cannot disagree.
 */
export function resolveTalentNames(
  palTalentNames: readonly string[],
  internetOn: boolean,
  notesOn: boolean = false,
): string[] {
  const names = palTalentNames.filter(
    name =>
      (internetOn || !isInternetTalent(name)) &&
      (notesOn || !isNotesTalent(name)),
  );
  if (internetOn) {
    for (const name of INTERNET_TALENT_NAMES) {
      if (!names.includes(name)) {
        names.push(name);
      }
    }
  }
  if (notesOn) {
    for (const name of NOTES_TALENT_NAMES) {
      if (!names.includes(name)) {
        names.push(name);
      }
    }
  }
  return names;
}

/** Same last-line guard as stripInternetTools, for the Notes memory switch. */
export function stripNotesTools<T extends {function?: {name?: string}}>(
  tools: T[] | undefined,
  notesOn: boolean,
): T[] | undefined {
  if (!tools || notesOn) {
    return tools;
  }
  const kept = tools.filter(tool => !isNotesTalent(tool.function?.name ?? ''));
  return kept.length > 0 ? kept : undefined;
}

/**
 * Last line of defence for the OFF state: drops internet tool schemas that
 * arrived from any other settings layer (a Pal's saved settings, or a session
 * that stored `tools` while the toggle was on).
 */
export function stripInternetTools<T extends {function?: {name?: string}}>(
  tools: T[] | undefined,
  internetOn: boolean,
): T[] | undefined {
  if (!tools || internetOn) {
    return tools;
  }
  const kept = tools.filter(
    tool => !isInternetTalent(tool.function?.name ?? ''),
  );
  return kept.length > 0 ? kept : undefined;
}

let registered = false;

/**
 * Register built-in talent engines. UI renderers register separately via
 * `registerDefaultTalentUIs` — keeps the talent UI out of this service module's
 * graph so engine-logic consumers don't load the bottom-sheet tree.
 */
export function registerDefaultTalents(): void {
  if (registered) {
    return;
  }
  talentRegistry.register(new RenderHtmlEngine());
  talentRegistry.register(new CalculateEngine());
  talentRegistry.register(new DatetimeEngine());
  const searchAccess = createSearchAccess();
  talentRegistry.register(new WebSearchEngine(searchAccess));
  talentRegistry.register(new ReadUrlEngine(searchAccess));
  const notesAccess = createNotesAccess();
  talentRegistry.register(new SaveNoteEngine(notesAccess));
  talentRegistry.register(new SearchNotesEngine(notesAccess));
  talentRegistry.register(new ReadNoteEngine(notesAccess));
  registered = true;
}

/**
 * Derive OpenAI-format tool schemas from registered engines.
 *
 * When `talentNames` is provided, only engines matching those names are
 * included — this ensures a Pal's completionSettings.tools matches its
 * pact.talents (the single source of truth for what the Pal advertises
 * to the model and what the dispatch loop will accept).
 *
 * Calls registerDefaultTalents() internally (idempotent).
 */
export function deriveToolSchemas(talentNames?: string[]): ToolDefinition[] {
  registerDefaultTalents();
  const engines = talentRegistry.getAll();
  if (!talentNames) {
    return engines.map(engine => engine.toToolDefinition());
  }
  const wanted = new Set(talentNames);
  return engines
    .filter(engine => wanted.has(engine.name))
    .map(engine => engine.toToolDefinition());
}

/**
 * Fragments are folded into the single leading system message by
 * `assembleMessages`; a talent never emits its own system message.
 */
export function collectSystemPromptFragments(
  talentNames: string[],
  ctx: Omit<SystemPromptContext, 'activeTalents'>,
  options: {explainInternetOff?: boolean} = {},
): string[] {
  registerDefaultTalents();
  const wanted = new Set(talentNames);
  const engineCtx: SystemPromptContext = {...ctx, activeTalents: wanted};
  const fragments = talentRegistry
    .getAll()
    .filter(engine => wanted.has(engine.name))
    .map(engine => engine.systemPromptFragment?.(engineCtx))
    .filter((fragment): fragment is string => !!fragment && !!fragment.trim());
  // Internet is a feature here (set up, or the Pal declares it) but switched
  // off: tell the model so it can explain the limit. Callers leave this false
  // otherwise so chats that never use search keep their prompt unchanged.
  if (options.explainInternetOff && !talentNames.some(isInternetTalent)) {
    fragments.push(INTERNET_OFF_PROMPT);
  }
  return fragments;
}

/**
 * Test helper: reset the `registered` guard so `registerDefaultTalents()` will
 * re-register engines after a `talentRegistry.reset()` call in test teardown.
 */
export function resetRegisteredFlag(): void {
  registered = false;
}
