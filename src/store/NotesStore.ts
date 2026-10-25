import {makeAutoObservable, runInAction} from 'mobx';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {makePersistable} from 'mobx-persist-store';

import {createFsNotesStorage} from '../services/notes/NotesStorage';
import type {NotesStorage} from '../services/notes/NotesStorage';

/**
 * The Notes memory switch. OFF by default: when off the model is offered no
 * note tools and the engines refuse, so nothing is read from or written to the
 * notes folder.
 */
class NotesStore {
  enabled = false;

  /** Not observable state: a plain handle to the on-device notes folder. */
  readonly storage: NotesStorage = createFsNotesStorage();

  constructor() {
    makeAutoObservable(this, {storage: false});
    Promise.resolve(
      makePersistable(this, {
        name: 'NotesStore',
        properties: ['enabled'],
        storage: AsyncStorage,
      }),
    ).then(() => {
      // Only a literal true counts, so a corrupted value can't enable it.
      runInAction(() => {
        this.enabled = (this.enabled as unknown) === true;
      });
    });
  }

  setEnabled(enabled: boolean) {
    runInAction(() => {
      this.enabled = enabled;
    });
  }

  /** Deletes every note. The user's action from Settings; no tool can call it. */
  async clearAll(): Promise<boolean> {
    try {
      await this.storage.clear();
      return true;
    } catch (error) {
      console.error('Failed to clear notes:', error);
      return false;
    }
  }
}

export const notesStore = new NotesStore();
export {NotesStore};
