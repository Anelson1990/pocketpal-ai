import {makeAutoObservable, runInAction} from 'mobx';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {makePersistable} from 'mobx-persist-store';
import * as Keychain from 'react-native-keychain';

import type {SearchProviderId} from '../services/search/types';
import {resetSearchCache} from '../services/search/searchBudget';

/** Distinct Keychain service per provider so iOS entries co-exist. */
const keychainService = (id: SearchProviderId): string =>
  `search_provider_service_${id}`;

export interface SearchProviderMeta {
  id: SearchProviderId;
  label: string;
  /** Gated providers appear in the picker but cannot be the active provider. */
  selectable: boolean;
  /** False for providers that work without a key (the key only raises limits). Defaults to true. */
  requiresKey?: boolean;
}

/** Parallel ships gated (not selectable) until its free-tier/PAYG terms are confirmed. */
export const SEARCH_PROVIDERS: SearchProviderMeta[] = [
  {id: 'tavily', label: 'Tavily', selectable: true},
  {id: 'brave', label: 'Brave', selectable: true},
  {id: 'exa', label: 'Exa', selectable: true},
  {id: 'firecrawl', label: 'Firecrawl', selectable: true},
  {id: 'you', label: 'You.com', selectable: true, requiresKey: false},
  {id: 'parallel', label: 'Parallel', selectable: false},
];

const DEFAULT_PROVIDER: SearchProviderId = 'brave';
const DEFAULT_RESULT_COUNT = 5;
const MIN_RESULT_COUNT = 1;
const MAX_RESULT_COUNT = 8;

/** Ceiling on tool rounds AND executed tool calls in one reply. */
export const DEFAULT_MAX_TOOL_CALLS = 5;
export const MIN_MAX_TOOL_CALLS = 1;
export const MAX_MAX_TOOL_CALLS = 10;

const clampMaxToolCalls = (raw: unknown): number =>
  typeof raw === 'number' && Number.isFinite(raw)
    ? Math.min(
        MAX_MAX_TOOL_CALLS,
        Math.max(MIN_MAX_TOOL_CALLS, Math.round(raw)),
      )
    : DEFAULT_MAX_TOOL_CALLS;

class SearchProviderStore {
  activeProviderId: SearchProviderId = DEFAULT_PROVIDER;
  resultCount: number = DEFAULT_RESULT_COUNT;
  hasConsentedToSearch = false;
  /**
   * The chat-UI Internet toggle. `null` = the user never touched it, in which
   * case it follows consent, so people who already enabled search keep working
   * and new users start OFF.
   */
  internetEnabled: boolean | null = null;
  maxToolCalls: number = DEFAULT_MAX_TOOL_CALLS;

  /** In-memory mirror of each provider's BYOK key (source of truth: Keychain). */
  private keys: Partial<Record<SearchProviderId, string>> = {};

  constructor() {
    makeAutoObservable(this);

    makePersistable(this, {
      name: 'SearchProviderStore',
      properties: [
        'activeProviderId',
        'resultCount',
        'hasConsentedToSearch',
        'internetEnabled',
        'maxToolCalls',
      ],
      storage: AsyncStorage,
    }).then(() => this.normalizeHydratedPrefs());

    this.loadKeysFromSecureStorage();
  }

  // Persisted prefs skip the setters — re-validate after hydration so a stale
  // gated/unknown provider, malformed type, or out-of-range count can't
  // survive a reload. Consent is a privacy gate: only a literal true counts.
  normalizeHydratedPrefs() {
    const meta = SEARCH_PROVIDERS.find(p => p.id === this.activeProviderId);
    const provider =
      meta && meta.selectable ? this.activeProviderId : DEFAULT_PROVIDER;
    const rawCount: unknown = this.resultCount;
    const count =
      typeof rawCount === 'number' && Number.isFinite(rawCount)
        ? Math.min(
            MAX_RESULT_COUNT,
            Math.max(MIN_RESULT_COUNT, Math.round(rawCount)),
          )
        : DEFAULT_RESULT_COUNT;
    const consent = (this.hasConsentedToSearch as unknown) === true;
    // Only a literal boolean is a deliberate choice; anything else is "unset".
    const rawInternet: unknown = this.internetEnabled;
    const internet = typeof rawInternet === 'boolean' ? rawInternet : null;
    const maxToolCalls = clampMaxToolCalls(this.maxToolCalls);
    runInAction(() => {
      this.activeProviderId = provider;
      this.resultCount = count;
      this.hasConsentedToSearch = consent;
      this.internetEnabled = internet;
      this.maxToolCalls = maxToolCalls;
    });
  }

  private async loadKeysFromSecureStorage() {
    for (const {id} of SEARCH_PROVIDERS) {
      try {
        const credentials = await Keychain.getGenericPassword({
          service: keychainService(id),
        });
        if (credentials) {
          runInAction(() => {
            this.keys[id] = credentials.password;
          });
        }
      } catch (error) {
        console.error(`Failed to load ${id} search key:`, error);
      }
    }
  }

  get providers(): SearchProviderMeta[] {
    return SEARCH_PROVIDERS;
  }

  getKey(id: SearchProviderId): string {
    return this.keys[id] ?? '';
  }

  hasKey(id: SearchProviderId): boolean {
    return (this.keys[id] ?? '').trim().length > 0;
  }

  /** True when the provider works without a key (a key is optional). */
  isKeyOptional(id: SearchProviderId): boolean {
    return SEARCH_PROVIDERS.find(p => p.id === id)?.requiresKey === false;
  }

  get isProviderConfigured(): boolean {
    return (
      this.isKeyOptional(this.activeProviderId) ||
      this.hasKey(this.activeProviderId)
    );
  }

  /** Consent given and a usable provider: search *could* be switched on. */
  get isSetUp(): boolean {
    return this.hasConsentedToSearch && this.isProviderConfigured;
  }

  /** The chat toggle's effective position (unset follows consent). */
  get isInternetOn(): boolean {
    return this.internetEnabled ?? this.hasConsentedToSearch;
  }

  /**
   * The single gate for every network lookup made for the model: tool
   * advertising, the run allowlist and each engine's execute() all read this.
   */
  get canSearch(): boolean {
    return this.isInternetOn && this.isSetUp;
  }

  setInternetEnabled(enabled: boolean) {
    runInAction(() => {
      this.internetEnabled = enabled;
    });
    resetSearchCache();
  }

  setMaxToolCalls(count: number) {
    const clamped = clampMaxToolCalls(count);
    runInAction(() => {
      this.maxToolCalls = clamped;
    });
  }

  setActiveProvider(id: SearchProviderId) {
    const meta = SEARCH_PROVIDERS.find(p => p.id === id);
    if (!meta || !meta.selectable) {
      return;
    }
    runInAction(() => {
      this.activeProviderId = id;
    });
    resetSearchCache();
  }

  setResultCount(count: number) {
    const clamped = Math.min(
      MAX_RESULT_COUNT,
      Math.max(MIN_RESULT_COUNT, Math.round(count)),
    );
    runInAction(() => {
      this.resultCount = clamped;
    });
  }

  setConsent(consented: boolean) {
    runInAction(() => {
      this.hasConsentedToSearch = consented;
    });
    resetSearchCache();
  }

  async setKey(id: SearchProviderId, key: string): Promise<boolean> {
    try {
      await Keychain.setGenericPassword(id, key, {
        service: keychainService(id),
      });
      runInAction(() => {
        this.keys[id] = key;
      });
      resetSearchCache();
      return true;
    } catch (error) {
      console.error(`Failed to save ${id} search key:`, error);
      return false;
    }
  }

  async clearKey(id: SearchProviderId): Promise<boolean> {
    try {
      await Keychain.resetGenericPassword({service: keychainService(id)});
      runInAction(() => {
        delete this.keys[id];
      });
      resetSearchCache();
      return true;
    } catch (error) {
      console.error(`Failed to clear ${id} search key:`, error);
      return false;
    }
  }
}

export const searchProviderStore = new SearchProviderStore();
export {SearchProviderStore};
