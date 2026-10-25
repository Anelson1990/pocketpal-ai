import {runInAction} from 'mobx';

import {chatSessionStore, defaultCompletionSettings} from '../ChatSessionStore';
import {palStore} from '../PalStore';
import {searchProviderStore} from '../SearchProviderStore';
import {resetRegisteredFlag} from '../../services/talents';
import {talentRegistry} from '../../services/talents/TalentRegistry';
import type {CompletionParams} from '../../utils/completionTypes';

const names = (settings: CompletionParams): string[] | undefined =>
  (settings.tools as Array<{function: {name: string}}> | undefined)?.map(
    t => t.function.name,
  );

const staleTool = (name: string) => ({
  type: 'function',
  function: {name, description: 'stale', parameters: {}},
});

const palWith = (talents: string[], completionSettings?: object) =>
  ({
    type: 'local',
    id: 'pal-1',
    name: 'Pal',
    description: '',
    systemPrompt: '',
    isSystemPromptChanged: false,
    useAIPrompt: false,
    parameters: {},
    parameterSchema: [],
    source: 'local',
    pact: {talents: talents.map(name => ({name, necessity: 'optional'}))},
    ...(completionSettings ? {completionSettings} : {}),
  }) as any;

/** consent + a key, with the toggle in the given position. */
const setSearch = async (toggle: boolean | null, setUp = true) => {
  await searchProviderStore.setKey('brave', setUp ? 'test-key' : '');
  if (!setUp) {
    await searchProviderStore.clearKey('brave');
  }
  runInAction(() => {
    searchProviderStore.hasConsentedToSearch = setUp;
    searchProviderStore.internetEnabled = toggle;
  });
};

describe('ChatSessionStore.resolveCompletionSettings — Internet toggle', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    talentRegistry.reset();
    resetRegisteredFlag();
    chatSessionStore.sessions = [];
    chatSessionStore.activeSessionId = null;
    chatSessionStore.newChatPalId = undefined;
    chatSessionStore.newChatCompletionSettings = {...defaultCompletionSettings};
    chatSessionStore.newChatThinkingOverride = undefined;
    palStore.pals = [];
    await setSearch(null, false);
  });

  describe('a chat with no Pal', () => {
    it('has no tools when the toggle is off', async () => {
      await setSearch(false);
      const settings = await chatSessionStore.resolveCompletionSettings();
      expect(settings.tools).toBeUndefined();
    });

    it('has no tools for a brand-new user who never set anything up', async () => {
      const settings = await chatSessionStore.resolveCompletionSettings();
      expect(settings.tools).toBeUndefined();
    });

    it('gets web_search and read_url when the toggle is on', async () => {
      await setSearch(true);
      const settings = await chatSessionStore.resolveCompletionSettings();
      expect(names(settings)).toEqual(['web_search', 'read_url']);
    });

    it('keeps working for a user who enabled search before the toggle existed (unset follows consent)', async () => {
      await setSearch(null);
      const settings = await chatSessionStore.resolveCompletionSettings();
      expect(names(settings)).toEqual(['web_search', 'read_url']);
    });

    it('turning on without consent/key advertises nothing (nothing could run)', async () => {
      runInAction(() => {
        searchProviderStore.internetEnabled = true;
      });
      const settings = await chatSessionStore.resolveCompletionSettings();
      expect(settings.tools).toBeUndefined();
    });
  });

  describe('a chat with a Pal', () => {
    it('adds internet tools to the Pal’s own talents when on', async () => {
      palStore.pals = [palWith(['calculate'])];
      await setSearch(true);
      const settings = await chatSessionStore.resolveCompletionSettings(
        undefined,
        'pal-1',
      );
      expect(names(settings)?.sort()).toEqual(
        ['calculate', 'read_url', 'web_search'].sort(),
      );
    });

    it('removes the internet talents a Pal declares when off, keeping the others', async () => {
      palStore.pals = [palWith(['calculate', 'web_search', 'read_url'])];
      await setSearch(false);
      const settings = await chatSessionStore.resolveCompletionSettings(
        undefined,
        'pal-1',
      );
      expect(names(settings)).toEqual(['calculate']);
    });

    it('a web-search-only Pal has no tools at all when off (not an empty array)', async () => {
      palStore.pals = [palWith(['web_search'])];
      await setSearch(false);
      const settings = await chatSessionStore.resolveCompletionSettings(
        undefined,
        'pal-1',
      );
      expect('tools' in settings && settings.tools !== undefined).toBe(false);
    });

    it('strips an internet tool that a Pal’s saved completion settings carry', async () => {
      palStore.pals = [
        palWith([], {tools: [staleTool('web_search'), staleTool('calculate')]}),
      ];
      await setSearch(false);
      const settings = await chatSessionStore.resolveCompletionSettings(
        undefined,
        'pal-1',
      );
      expect(names(settings)).toEqual(['calculate']);
    });
  });

  describe('switching during a conversation', () => {
    const customSession = (tools?: object[]) =>
      ({
        id: 'sess-1',
        title: 'Chat',
        date: '',
        messages: [],
        settingsSource: 'custom',
        completionSettings: {
          ...defaultCompletionSettings,
          temperature: 0.2,
          ...(tools ? {tools} : {}),
        },
      }) as any;

    it('a custom-settings session that stored web_search while ON loses it once OFF', async () => {
      chatSessionStore.sessions = [
        customSession([staleTool('web_search'), staleTool('read_url')]),
      ];
      await setSearch(false);

      const settings =
        await chatSessionStore.resolveCompletionSettings('sess-1');

      expect(settings.tools).toBeUndefined();
      // The user's own generation settings are untouched.
      expect(settings.temperature).toBe(0.2);
    });

    it('the same session follows the toggle off → on → off between messages', async () => {
      chatSessionStore.sessions = [customSession()];

      await setSearch(false);
      expect(
        (await chatSessionStore.resolveCompletionSettings('sess-1')).tools,
      ).toBeUndefined();

      await setSearch(true);
      expect(
        names(await chatSessionStore.resolveCompletionSettings('sess-1')),
      ).toEqual(['web_search', 'read_url']);

      searchProviderStore.setInternetEnabled(false);
      expect(
        (await chatSessionStore.resolveCompletionSettings('sess-1')).tools,
      ).toBeUndefined();
    });

    it('a Pal session follows the toggle too, without losing Pal tools', async () => {
      palStore.pals = [palWith(['calculate'])];
      chatSessionStore.sessions = [
        {
          id: 'sess-2',
          title: 'Chat',
          date: '',
          messages: [],
          settingsSource: 'pal',
          activePalId: 'pal-1',
          completionSettings: {...defaultCompletionSettings},
        } as any,
      ];

      await setSearch(true);
      expect(
        names(
          await chatSessionStore.resolveCompletionSettings('sess-2', 'pal-1'),
        )?.sort(),
      ).toEqual(['calculate', 'read_url', 'web_search']);

      searchProviderStore.setInternetEnabled(false);
      expect(
        names(
          await chatSessionStore.resolveCompletionSettings('sess-2', 'pal-1'),
        ),
      ).toEqual(['calculate']);
    });

    it('revoking consent switches tools off even though the toggle is still on', async () => {
      await setSearch(true);
      expect(
        names(await chatSessionStore.resolveCompletionSettings()),
      ).toBeDefined();

      searchProviderStore.setConsent(false);

      expect(
        (await chatSessionStore.resolveCompletionSettings()).tools,
      ).toBeUndefined();
    });
  });
});
