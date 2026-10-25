// In-memory fake of the parts of react-native-fs the notes folder uses.
const mockFs = new Map<string, {text: string; mtime: number}>();
const mockDirs = new Set<string>();
let mockClock = 0;

jest.mock('@dr.pogodin/react-native-fs', () => ({
  DocumentDirectoryPath: '/docs',
  exists: jest.fn(async (p: string) => mockFs.has(p) || mockDirs.has(p)),
  mkdir: jest.fn(async (p: string) => {
    mockDirs.add(p);
  }),
  readDir: jest.fn(async (p: string) =>
    [...mockFs.entries()]
      .filter(([path]) => path.startsWith(`${p}/`))
      .map(([path, f]) => ({
        name: path.slice(p.length + 1),
        mtime: new Date(f.mtime),
        isFile: () => true,
      })),
  ),
  readFile: jest.fn(async (p: string) => {
    const f = mockFs.get(p);
    if (!f) {
      throw new Error('ENOENT');
    }
    return f.text;
  }),
  writeFile: jest.fn(async (p: string, text: string) => {
    mockFs.set(p, {text, mtime: ++mockClock});
  }),
  unlink: jest.fn(async (p: string) => {
    for (const key of [...mockFs.keys()]) {
      if (key === p || key.startsWith(`${p}/`)) {
        mockFs.delete(key);
      }
    }
    mockDirs.delete(p);
  }),
}));

import {createFsNotesStorage} from '../NotesStorage';

describe('createFsNotesStorage', () => {
  beforeEach(() => {
    mockFs.clear();
    mockDirs.clear();
    mockClock = 0;
  });

  it('creates the folder and file on first append', async () => {
    const s = createFsNotesStorage();
    await s.append('teams', 'Teams', 'Lakers');
    expect(mockDirs.has('/docs/notes')).toBe(true);
    expect(mockFs.get('/docs/notes/teams.md')?.text).toBe('# Teams\n\nLakers');
  });

  it('appends to an existing note without replacing it', async () => {
    const s = createFsNotesStorage();
    await s.append('teams', 'Teams', 'Lakers');
    await s.append('teams', 'Teams', 'Celtics');
    expect(await s.read('teams')).toBe('# Teams\n\nLakers\n\nCeltics');
  });

  it('lists newest first with the title taken from the heading', async () => {
    const s = createFsNotesStorage();
    await s.append('a', 'First Note', 'x');
    await s.append('b', 'Second Note', 'y');
    const list = await s.list();
    expect(list.map(n => n.title)).toEqual(['Second Note', 'First Note']);
  });

  it('lists nothing when the folder does not exist yet', async () => {
    expect(await createFsNotesStorage().list()).toEqual([]);
  });

  it('ignores files that are not valid note files', async () => {
    const s = createFsNotesStorage();
    mockDirs.add('/docs/notes');
    mockFs.set('/docs/notes/..evil.md', {text: 'x', mtime: 1});
    mockFs.set('/docs/notes/readme.txt', {text: 'x', mtime: 1});
    mockFs.set('/docs/notes/ok.md', {text: '# Ok\n\nx', mtime: 1});
    expect((await s.list()).map(n => n.slug)).toEqual(['ok']);
  });

  it.each(['../x', 'a/b', '', 'A', 'a b', '.hidden', 'a--b'])(
    'refuses to read or write the unsafe id %p',
    async id => {
      const s = createFsNotesStorage();
      expect(await s.read(id)).toBeNull();
      await expect(s.append(id, 't', 'c')).rejects.toThrow();
    },
  );

  it('returns null for a note that does not exist', async () => {
    expect(await createFsNotesStorage().read('missing')).toBeNull();
  });

  it('clear removes every note and tolerates an empty folder', async () => {
    const s = createFsNotesStorage();
    await expect(s.clear()).resolves.toBeUndefined();
    await s.append('a', 'A', 'x');
    await s.clear();
    expect(await s.list()).toEqual([]);
  });
});
