import {makeAutoObservable} from 'mobx';

import {SEARCH_PROVIDERS} from '../../src/store/SearchProviderStore';
import type {SearchProviderId} from '../../src/services/search/types';

class MockSearchProviderStore {
  activeProviderId: SearchProviderId = 'brave';
  resultCount = 5;
  hasConsentedToSearch = false;
  internetEnabled: boolean | null = null;
  maxToolCalls = 5;

  private keys: Partial<Record<SearchProviderId, string>> = {};

  setActiveProvider: jest.Mock;
  setResultCount: jest.Mock;
  setConsent: jest.Mock;
  setInternetEnabled: jest.Mock;
  setMaxToolCalls: jest.Mock;
  setKey: jest.Mock;
  clearKey: jest.Mock;

  constructor() {
    makeAutoObservable(this, {
      setActiveProvider: false,
      setResultCount: false,
      setConsent: false,
      setInternetEnabled: false,
      setMaxToolCalls: false,
      setKey: false,
      clearKey: false,
    });

    this.setActiveProvider = jest.fn((id: SearchProviderId) => {
      this.activeProviderId = id;
    });
    this.setResultCount = jest.fn((count: number) => {
      this.resultCount = count;
    });
    this.setConsent = jest.fn((consented: boolean) => {
      this.hasConsentedToSearch = consented;
    });
    this.setInternetEnabled = jest.fn((enabled: boolean) => {
      this.internetEnabled = enabled;
    });
    this.setMaxToolCalls = jest.fn((count: number) => {
      this.maxToolCalls = count;
    });
    this.setKey = jest.fn(async (id: SearchProviderId, key: string) => {
      this.keys[id] = key;
      return true;
    });
    this.clearKey = jest.fn(async (id: SearchProviderId) => {
      delete this.keys[id];
      return true;
    });
  }

  get providers() {
    return SEARCH_PROVIDERS;
  }

  getKey(id: SearchProviderId): string {
    return this.keys[id] ?? '';
  }

  hasKey(id: SearchProviderId): boolean {
    return (this.keys[id] ?? '').trim().length > 0;
  }

  isKeyOptional(id: SearchProviderId): boolean {
    return SEARCH_PROVIDERS.find(p => p.id === id)?.requiresKey === false;
  }

  get isProviderConfigured(): boolean {
    return (
      this.isKeyOptional(this.activeProviderId) ||
      this.hasKey(this.activeProviderId)
    );
  }

  get isSetUp(): boolean {
    return this.hasConsentedToSearch && this.isProviderConfigured;
  }

  get isInternetOn(): boolean {
    return this.internetEnabled ?? this.hasConsentedToSearch;
  }

  get canSearch(): boolean {
    return this.isInternetOn && this.isSetUp;
  }
}

export const mockSearchProviderStore = new MockSearchProviderStore();
