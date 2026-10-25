import {runInAction} from 'mobx';

import {chatSessionStore, defaultCompletionSettings} from '../ChatSessionStore';
import {palStore} from '../PalStore';
import {searchProviderStore} from '../SearchProviderStore';
import {notesStore} from '../NotesStore';
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

const setNotes = (on: boolean) => notesStore.setEnabled(on);
const setInternet = (on: boolean) =>
  runInAction(() => {
    searchProviderStore.internetEnabled = on;
  });

describe('ChatSessionStore.resolveCompletionSettings — Notes memory switch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    talentRegistry.reset();
    resetRegisteredFlag();
    chatSessionStore.sessions = [];
    chatSessionStore.activeSessionId = null;
    chatSessionStore.newChatPalId = undefined;
    chatSessionStore.newChatCompletionSettings = {...defaultCompletionSettings};
    chatSessionStore.newChatThinkingOverride = undefined;
    palStore.pals = [];
    setNotes(false);
    setInternet(false);
  });

  it('is OFF by default: a plain chat gets no tools', async () => {
    const settings = await chatSessionStore.resolveCompletionSettings();
    expect(settings.tools).toBeUndefined();
  });

  it('ON gives a no-Pal chat the three note tools', async () => {
    setNotes(true);
    const settings = await chatSessionStore.resolveCompletionSettings();
    expect(names(settings)).toEqual(['save_note', 'search_notes', 'read_note']);
  });

  it('ON adds note tools to a Pal’s own talents', async () => {
    palStore.pals = [palWith(['calculate'])];
    setNotes(true);
    const settings = await chatSessionStore.resolveCompletionSettings(
      undefined,
      'pal-1',
    );
    expect(names(settings)?.sort()).toEqual(
      ['calculate', 'read_note', 'save_note', 'search_notes'].sort(),
    );
  });

  it('OFF strips note tools a Pal declares and tools saved in its settings', async () => {
    palStore.pals = [
      palWith(['calculate', 'save_note'], {
        tools: [staleTool('read_note'), staleTool('calculate')],
      }),
    ];
    const settings = await chatSessionStore.resolveCompletionSettings(
      undefined,
      'pal-1',
    );
    expect(names(settings)).toEqual(['calculate']);
  });

  it('OFF strips note tools a custom-settings session stored while ON', async () => {
    chatSessionStore.sessions = [
      {
        id: 'sess-1',
        title: 'Chat',
        date: '',
        messages: [],
        settingsSource: 'custom',
        completionSettings: {
          ...defaultCompletionSettings,
          temperature: 0.3,
          tools: [staleTool('save_note'), staleTool('search_notes')],
        },
      } as any,
    ];
    const settings = await chatSessionStore.resolveCompletionSettings('sess-1');
    expect(settings.tools).toBeUndefined();
    expect(settings.temperature).toBe(0.3);
  });

  it('follows the switch between messages', async () => {
    expect(
      (await chatSessionStore.resolveCompletionSettings()).tools,
    ).toBeUndefined();
    setNotes(true);
    expect(names(await chatSessionStore.resolveCompletionSettings())).toContain(
      'save_note',
    );
    setNotes(false);
    expect(
      (await chatSessionStore.resolveCompletionSettings()).tools,
    ).toBeUndefined();
  });

  it('the Internet and Notes switches do not affect each other', async () => {
    setNotes(true);
    setInternet(true);
    await searchProviderStore.setKey('brave', 'k');
    runInAction(() => {
      searchProviderStore.hasConsentedToSearch = true;
    });
    expect(
      names(await chatSessionStore.resolveCompletionSettings())?.sort(),
    ).toEqual(
      [
        'read_note',
        'read_url',
        'save_note',
        'search_notes',
        'web_search',
      ].sort(),
    );
    setInternet(false);
    expect(
      names(await chatSessionStore.resolveCompletionSettings())?.sort(),
    ).toEqual(['read_note', 'save_note', 'search_notes'].sort());
    setNotes(false);
    setInternet(true);
    expect(
      names(await chatSessionStore.resolveCompletionSettings())?.sort(),
    ).toEqual(['read_url', 'web_search'].sort());
  });
});
