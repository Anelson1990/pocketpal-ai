import {
  collectSystemPromptFragments,
  INTERNET_OFF_MESSAGE,
  INTERNET_OFF_PROMPT,
  INTERNET_TALENT_NAMES,
  resetRegisteredFlag,
  resolveTalentNames,
  SEARCH_NOT_SET_UP_MESSAGE,
  stripInternetTools,
} from '../index';
import {talentRegistry} from '../TalentRegistry';
import {WebSearchEngine, MAX_QUERY_CHARS} from '../WebSearchEngine';
import {ReadUrlEngine, MAX_URL_CHARS} from '../ReadUrlEngine';
import {allowReadUrls, resetReadUrlAllowlist} from '../readUrlAllowlist';
import type {SearchAccess} from '../searchAccess';
import type {SearchProvider} from '../../search/types';
import {resetSearchCache} from '../../search/searchBudget';

const ctx = {now: new Date('2026-10-25T12:00:00Z'), maxToolTurns: 5};

const makeAccess = (
  state: {on: boolean; setUp: boolean},
  provider: SearchProvider,
): SearchAccess => ({
  getActiveProvider: () => provider,
  canSearch: () => state.on && state.setUp,
  isInternetOn: () => state.on,
  getResultCount: () => 3,
  readWithDefaultReader: jest.fn(),
});

const makeProvider = (): jest.Mocked<SearchProvider> => ({
  id: 'brave',
  search: jest
    .fn()
    .mockResolvedValue([
      {title: 'T', url: 'https://example.com/a', snippet: 's'},
    ]),
  read: jest.fn().mockResolvedValue({url: 'https://e.com', text: 'body'}),
});

describe('resolveTalentNames (toggle → talents)', () => {
  it('ON adds web_search and read_url to a chat with no Pal', () => {
    expect(resolveTalentNames([], true)).toEqual(['web_search', 'read_url']);
  });

  it('ON keeps the Pal talents and does not duplicate internet ones', () => {
    const names = resolveTalentNames(['calculate', 'web_search'], true);
    expect(names).toEqual(['calculate', 'web_search', 'read_url']);
  });

  it('OFF yields no internet talent for a plain chat', () => {
    expect(resolveTalentNames([], false)).toEqual([]);
  });

  it('OFF removes the internet talents a Pal declares, keeping the rest', () => {
    expect(
      resolveTalentNames(['calculate', 'web_search', 'read_url'], false),
    ).toEqual(['calculate']);
  });

  it('does not mutate its input', () => {
    const input = ['calculate'];
    resolveTalentNames(input, true);
    expect(input).toEqual(['calculate']);
  });

  it('only web_search and read_url count as internet talents', () => {
    expect([...INTERNET_TALENT_NAMES]).toEqual(['web_search', 'read_url']);
    expect(
      resolveTalentNames(['render_html', 'calculate', 'datetime'], false),
    ).toEqual(['render_html', 'calculate', 'datetime']);
  });
});

describe('stripInternetTools (last-line OFF guard)', () => {
  const tool = (name: string) => ({
    type: 'function' as const,
    function: {name},
  });

  it('drops internet tool schemas when OFF', () => {
    const kept = stripInternetTools(
      [tool('calculate'), tool('web_search'), tool('read_url')],
      false,
    );
    expect(kept?.map(t => t.function.name)).toEqual(['calculate']);
  });

  it('returns undefined when nothing is left, so no empty tools array is sent', () => {
    expect(
      stripInternetTools([tool('web_search'), tool('read_url')], false),
    ).toBeUndefined();
  });

  it('is a no-op when ON', () => {
    const tools = [tool('web_search')];
    expect(stripInternetTools(tools, true)).toBe(tools);
  });

  it('passes undefined through', () => {
    expect(stripInternetTools(undefined, false)).toBeUndefined();
  });

  it('tolerates a malformed entry without a function name', () => {
    const kept = stripInternetTools([{} as any, tool('web_search')], false);
    expect(kept).toHaveLength(1);
  });
});

describe('collectSystemPromptFragments: internet-off explanation', () => {
  beforeEach(() => {
    talentRegistry.reset();
    resetRegisteredFlag();
  });

  it('adds the explanation when asked and no internet tool is active', () => {
    const fragments = collectSystemPromptFragments(['calculate'], ctx, {
      explainInternetOff: true,
    });
    expect(fragments).toContain(INTERNET_OFF_PROMPT);
  });

  it('leaves the prompt untouched by default (chats that never use search)', () => {
    expect(collectSystemPromptFragments(['calculate'], ctx)).toEqual([]);
    expect(collectSystemPromptFragments([], ctx)).toEqual([]);
  });

  it('never says internet is off while an internet tool is active', () => {
    const fragments = collectSystemPromptFragments(
      ['web_search', 'read_url'],
      ctx,
      {explainInternetOff: true},
    );
    expect(fragments).not.toContain(INTERNET_OFF_PROMPT);
    expect(fragments.join('\n')).toContain('web_search');
  });

  it('tells the model how to explain the limit and where the switch is', () => {
    expect(INTERNET_OFF_PROMPT).toMatch(/cannot search the web/i);
    expect(INTERNET_OFF_PROMPT).toMatch(/globe button/i);
    expect(INTERNET_OFF_PROMPT).toMatch(/out of date/i);
  });
});

describe('engines refuse when the toggle is OFF, with a reason', () => {
  beforeEach(() => {
    resetSearchCache();
    resetReadUrlAllowlist();
    allowReadUrls(['https://e.com']);
  });

  it('web_search: OFF makes no provider call and explains how to turn it on', async () => {
    const provider = makeProvider();
    const engine = new WebSearchEngine(
      makeAccess({on: false, setUp: true}, provider),
    );
    const result = await engine.execute({query: 'nba scores'});
    expect(provider.search).not.toHaveBeenCalled();
    expect(result.type).toBe('error');
    expect(result.summary).toContain(INTERNET_OFF_MESSAGE);
    expect(INTERNET_OFF_MESSAGE).toMatch(/globe button/i);
  });

  it('web_search: ON but not set up says setup is missing, not that it is off', async () => {
    const provider = makeProvider();
    const engine = new WebSearchEngine(
      makeAccess({on: true, setUp: false}, provider),
    );
    const result = await engine.execute({query: 'nba scores'});
    expect(provider.search).not.toHaveBeenCalled();
    expect(result.summary).toContain(SEARCH_NOT_SET_UP_MESSAGE);
    expect(result.summary).not.toContain(INTERNET_OFF_MESSAGE);
  });

  it('web_search: ON and set up runs the search', async () => {
    const provider = makeProvider();
    const engine = new WebSearchEngine(
      makeAccess({on: true, setUp: true}, provider),
    );
    const result = await engine.execute({query: 'nba scores'});
    expect(provider.search).toHaveBeenCalledTimes(1);
    expect(result.type).toBe('search');
  });

  it('web_search: reacts to the toggle flipping between two calls on one engine', async () => {
    const provider = makeProvider();
    const state = {on: true, setUp: true};
    const engine = new WebSearchEngine(makeAccess(state, provider));

    expect((await engine.execute({query: 'first query'})).type).toBe('search');
    state.on = false;
    const blocked = await engine.execute({query: 'second query'});
    expect(blocked.type).toBe('error');
    expect(provider.search).toHaveBeenCalledTimes(1);
    state.on = true;
    expect((await engine.execute({query: 'third query'})).type).toBe('search');
    expect(provider.search).toHaveBeenCalledTimes(2);
  });

  it('read_url: OFF makes no provider or reader call', async () => {
    const provider = makeProvider();
    const access = makeAccess({on: false, setUp: true}, provider);
    const engine = new ReadUrlEngine(access);
    const result = await engine.execute({url: 'https://e.com'});
    expect(provider.read).not.toHaveBeenCalled();
    expect(access.readWithDefaultReader).not.toHaveBeenCalled();
    expect(result.type).toBe('error');
    expect(result.summary).toContain(INTERNET_OFF_MESSAGE);
  });

  it('read_url: ON reads an allowed page', async () => {
    const provider = makeProvider();
    const engine = new ReadUrlEngine(
      makeAccess({on: true, setUp: true}, provider),
    );
    const result = await engine.execute({url: 'https://e.com'});
    expect(provider.read).toHaveBeenCalledTimes(1);
    expect(result.type).toBe('text');
  });
});

describe('argument limits (nothing big leaves the device)', () => {
  beforeEach(() => {
    resetSearchCache();
    resetReadUrlAllowlist();
  });

  it('web_search rejects a query over the cap without a network call', async () => {
    const provider = makeProvider();
    const engine = new WebSearchEngine(
      makeAccess({on: true, setUp: true}, provider),
    );
    const result = await engine.execute({
      query: 'a'.repeat(MAX_QUERY_CHARS + 1),
    });
    expect(provider.search).not.toHaveBeenCalled();
    expect(result.type).toBe('error');
    expect(result.summary).toMatch(/too long/);
  });

  it('web_search accepts a query exactly at the cap', async () => {
    const provider = makeProvider();
    const engine = new WebSearchEngine(
      makeAccess({on: true, setUp: true}, provider),
    );
    const result = await engine.execute({query: 'a'.repeat(MAX_QUERY_CHARS)});
    expect(provider.search).toHaveBeenCalledTimes(1);
    expect(result.type).toBe('search');
  });

  it.each([[42], [null], [undefined], [{q: 'x'}], [['x']], [true]])(
    'web_search rejects a non-string query (%p)',
    async bad => {
      const provider = makeProvider();
      const engine = new WebSearchEngine(
        makeAccess({on: true, setUp: true}, provider),
      );
      const result = await engine.execute({query: bad as any});
      expect(result.type).toBe('error');
      expect(provider.search).not.toHaveBeenCalled();
    },
  );

  it('read_url rejects an over-long URL without a network call', async () => {
    const provider = makeProvider();
    const engine = new ReadUrlEngine(
      makeAccess({on: true, setUp: true}, provider),
    );
    const longUrl = `https://e.com/${'a'.repeat(MAX_URL_CHARS)}`;
    allowReadUrls([longUrl]);
    const result = await engine.execute({url: longUrl});
    expect(provider.read).not.toHaveBeenCalled();
    expect(result.type).toBe('error');
    expect(result.summary).toMatch(/too long/);
  });

  it.each([
    ['file:///etc/passwd'],
    ['javascript:alert(1)'],
    ['content://com.android.contacts'],
    ['ftp://example.com/x'],
    ['https://user:pass@example.com/'],
  ])('read_url refuses non-web or credentialed URL %s', async url => {
    const provider = makeProvider();
    const engine = new ReadUrlEngine(
      makeAccess({on: true, setUp: true}, provider),
    );
    const result = await engine.execute({url});
    expect(result.type).toBe('error');
    expect(provider.read).not.toHaveBeenCalled();
  });
});
