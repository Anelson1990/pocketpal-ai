import * as RNFS from '@dr.pogodin/react-native-fs';

/** Hard limits: notes are for short durable facts, not documents. */
export const MAX_NOTE_CHARS = 4000;
export const MAX_NOTE_TOTAL_CHARS = 20000;
export const MAX_NOTES = 200;
export const MAX_TITLE_CHARS = 60;

export interface NoteMeta {
  /** File-safe id derived from the title; the only thing a path is built from. */
  slug: string;
  title: string;
  modifiedAt: number;
}

export interface NotesStorage {
  list(): Promise<NoteMeta[]>;
  /** Raw note text, or null when it doesn't exist. */
  read(slug: string): Promise<string | null>;
  /** Creates the note, or appends to it. Never replaces existing text. */
  append(slug: string, title: string, content: string): Promise<void>;
  /** Removes every note. Only reachable from Settings, never from a tool. */
  clear(): Promise<void>;
}

/**
 * Titles become file names, so reduce them to [a-z0-9-]. This is what keeps a
 * model-supplied title like "../../secret" from ever reaching a path.
 */
export const slugify = (title: string): string =>
  title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_TITLE_CHARS)
    .replace(/-+$/g, '');

const SLUG_FILE = /^[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;

const titleFromContent = (slug: string, text: string): string => {
  const first = text.split('\n', 1)[0] ?? '';
  return first.startsWith('# ') ? first.slice(2).trim() || slug : slug;
};

/** Notes live as plain Markdown files inside the app's private folder. */
export const createFsNotesStorage = (): NotesStorage => {
  const dir = () => `${RNFS.DocumentDirectoryPath}/notes`;
  const file = (slug: string) => `${dir()}/${slug}.md`;
  const ensureDir = async () => {
    if (!(await RNFS.exists(dir()))) {
      await RNFS.mkdir(dir());
    }
  };

  return {
    async list() {
      if (!(await RNFS.exists(dir()))) {
        return [];
      }
      const items = await RNFS.readDir(dir());
      const metas: NoteMeta[] = [];
      for (const item of items) {
        if (!item.isFile() || !SLUG_FILE.test(item.name)) {
          continue;
        }
        const slug = item.name.slice(0, -3);
        let title = slug;
        try {
          title = titleFromContent(slug, await RNFS.readFile(file(slug)));
        } catch {
          // Unreadable file: still list it by slug.
        }
        metas.push({
          slug,
          title,
          modifiedAt: item.mtime ? new Date(item.mtime).getTime() : 0,
        });
      }
      return metas.sort((a, b) => b.modifiedAt - a.modifiedAt);
    },

    async read(slug) {
      if (!SLUG_FILE.test(`${slug}.md`) || !(await RNFS.exists(file(slug)))) {
        return null;
      }
      return RNFS.readFile(file(slug));
    },

    async append(slug, title, content) {
      if (!SLUG_FILE.test(`${slug}.md`)) {
        throw new Error('invalid note id');
      }
      await ensureDir();
      if (await RNFS.exists(file(slug))) {
        const existing = await RNFS.readFile(file(slug));
        await RNFS.writeFile(file(slug), `${existing}\n\n${content}`, 'utf8');
      } else {
        await RNFS.writeFile(file(slug), `# ${title}\n\n${content}`, 'utf8');
      }
    },

    async clear() {
      if (await RNFS.exists(dir())) {
        await RNFS.unlink(dir());
      }
    },
  };
};
