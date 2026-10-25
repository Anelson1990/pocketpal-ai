import type {SearchProvider, PageContent} from '../search/types';

export const SEARCH_NOT_SET_UP_MESSAGE =
  "Internet search isn't set up yet. Finish setup in Settings → Internet Search.";

/** Tool result when the chat's Internet toggle is OFF (e.g. flipped mid-run). */
export const INTERNET_OFF_MESSAGE =
  'Internet access is turned off, so this lookup was not made. Tell the user you cannot look this up right now and that they can turn Internet access on with the globe button under the message box.';

/**
 * Added to the system prompt when no internet tool is available, so the model
 * says so instead of guessing at live facts or pretending to have searched.
 */
export const INTERNET_OFF_PROMPT =
  'Internet access is off: you cannot search the web or open links. ' +
  "If asked for live or recent information or to open a URL, say you can't look it up now " +
  'and that the user can turn on Internet access with the globe button under the message box. ' +
  'Otherwise answer from your own knowledge, noting it may be out of date.';

/**
 * Injected at `registerDefaultTalents()` so the search engines never import
 * `SearchProviderStore` — keeps `execute()` free of MobX/store coupling.
 */
export interface SearchAccess {
  getActiveProvider(): SearchProvider;
  /**
   * True only when the Internet toggle is on, the user has consented and the
   * active provider is configured (has a key, unless it needs none).
   * Consent and the toggle are enforced here, not just in the UI.
   */
  canSearch(): boolean;
  /** The Internet toggle's effective position, so a refusal can say why. */
  isInternetOn(): boolean;
  getResultCount(): number;
  readWithDefaultReader(
    url: string,
    signal?: AbortSignal,
  ): Promise<PageContent>;
}
