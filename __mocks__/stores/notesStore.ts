import {makeAutoObservable} from 'mobx';

class MockNotesStore {
  enabled = false;
  storage = {
    list: jest.fn().mockResolvedValue([]),
    read: jest.fn().mockResolvedValue(null),
    append: jest.fn().mockResolvedValue(undefined),
    clear: jest.fn().mockResolvedValue(undefined),
  };
  setEnabled: jest.Mock;
  clearAll: jest.Mock;

  constructor() {
    makeAutoObservable(this, {
      storage: false,
      setEnabled: false,
      clearAll: false,
    });
    this.setEnabled = jest.fn((enabled: boolean) => {
      this.enabled = enabled;
    });
    this.clearAll = jest.fn().mockResolvedValue(true);
  }
}

export const mockNotesStore = new MockNotesStore();
