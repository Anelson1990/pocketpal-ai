import {
  NOTES_TALENT_NAMES,
  collectSystemPromptFragments,
  deriveToolSchemas,
  resetRegisteredFlag,
  resolveTalentNames,
  stripNotesTools,
} from '../index';
import {talentRegistry} from '../TalentRegistry';

const tool = (name: string) => ({type: 'function' as const, function: {name}});

describe('resolveTalentNames with the Notes switch', () => {
  it('OFF (the default) adds no note tools', () => {
    expect(resolveTalentNames([], false)).toEqual([]);
    expect(resolveTalentNames(['calculate'], true, false)).not.toContain(
      'save_note',
    );
  });

  it('ON adds all three note tools for a chat with no Pal', () => {
    expect(resolveTalentNames([], false, true)).toEqual([
      'save_note',
      'search_notes',
      'read_note',
    ]);
    expect([...NOTES_TALENT_NAMES]).toEqual([
      'save_note',
      'search_notes',
      'read_note',
    ]);
  });

  it('OFF removes note tools a Pal declares, keeping the rest', () => {
    expect(
      resolveTalentNames(['calculate', 'save_note', 'read_note'], false, false),
    ).toEqual(['calculate']);
  });

  it('ON does not duplicate note tools a Pal already declares', () => {
    const names = resolveTalentNames(['save_note'], false, true);
    expect(names.filter(n => n === 'save_note')).toHaveLength(1);
  });

  it('is independent of the Internet switch', () => {
    expect(resolveTalentNames([], true, true)).toEqual([
      'web_search',
      'read_url',
      'save_note',
      'search_notes',
      'read_note',
    ]);
    expect(resolveTalentNames([], true, false)).toEqual([
      'web_search',
      'read_url',
    ]);
    expect(resolveTalentNames([], false, true)).not.toContain('web_search');
  });
});

describe('stripNotesTools (last-line OFF guard)', () => {
  it('drops note schemas when OFF and keeps others', () => {
    const kept = stripNotesTools(
      [tool('calculate'), tool('save_note'), tool('web_search')],
      false,
    );
    expect(kept?.map(t => t.function.name)).toEqual([
      'calculate',
      'web_search',
    ]);
  });

  it('returns undefined when nothing is left', () => {
    expect(
      stripNotesTools([tool('save_note'), tool('read_note')], false),
    ).toBeUndefined();
  });

  it('is a no-op when ON, and passes undefined through', () => {
    const tools = [tool('save_note')];
    expect(stripNotesTools(tools, true)).toBe(tools);
    expect(stripNotesTools(undefined, false)).toBeUndefined();
  });
});

describe('registration', () => {
  beforeEach(() => {
    talentRegistry.reset();
    resetRegisteredFlag();
  });

  it('registers the three note engines and derives valid schemas', () => {
    const schemas = deriveToolSchemas([...NOTES_TALENT_NAMES]);
    expect(schemas.map(s => s.function.name).sort()).toEqual(
      ['read_note', 'save_note', 'search_notes'].sort(),
    );
    for (const s of schemas) {
      expect(s.type).toBe('function');
      expect(s.function.description.length).toBeGreaterThan(10);
    }
  });

  it('only adds the notes system prompt when save_note is active', () => {
    const ctx = {now: new Date('2026-10-25T12:00:00Z'), maxToolTurns: 5};
    expect(collectSystemPromptFragments(['calculate'], ctx)).toEqual([]);
    const withNotes = collectSystemPromptFragments(
      ['save_note', 'search_notes'],
      ctx,
    ).join('\n');
    expect(withNotes).toMatch(/private notes/);
    expect(withNotes).toMatch(/not instructions/);
  });
});
