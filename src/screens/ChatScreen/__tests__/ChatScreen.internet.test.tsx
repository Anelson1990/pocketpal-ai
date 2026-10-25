import React from 'react';
import {runInAction} from 'mobx';

import {LlamaContext} from 'llama.rn';
import {
  render as baseRender,
  fireEvent,
  act,
} from '../../../../jest/test-utils';
import {ChatScreen} from '../ChatScreen';

import {
  modelStore,
  palStore,
  uiStore,
  searchProviderStore,
} from '../../../store';

import {l10n} from '../../../locales';
import {mockLlamaContextParams} from '../../../../jest/fixtures/models';

const render = (ui: React.ReactElement, options: any = {}) =>
  baseRender(ui, {withBottomSheetProvider: true, ...options});

const mockStore = searchProviderStore as any;

const setSearch = (state: {
  consent: boolean;
  key: boolean;
  toggle: boolean | null;
}) => {
  runInAction(() => {
    mockStore.hasConsentedToSearch = state.consent;
    mockStore.internetEnabled = state.toggle;
    mockStore.keys = state.key ? {brave: 'k'} : {};
    mockStore.activeProviderId = 'brave';
  });
};

describe('ChatScreen Internet toggle', () => {
  let savedModels: any[];

  beforeEach(() => {
    jest.clearAllMocks();
    savedModels = modelStore.models;
    runInAction(() => {
      modelStore.models = [{...savedModels[0], id: 'net-model'}];
      modelStore.activeModelId = 'net-model';
      modelStore.context = new LlamaContext(mockLlamaContextParams);
    });
    modelStore.engine = {
      completion: jest.fn(),
      stopCompletion: jest.fn(),
    } as any;
    setSearch({consent: false, key: false, toggle: null});
  });

  afterEach(() => {
    modelStore.models = savedModels;
    modelStore.activeModelId = undefined;
  });

  it('shows the pill when a model is active', () => {
    const {queryByTestId} = render(<ChatScreen />, {withNavigation: true});
    expect(queryByTestId('internet-toggle')).toBeTruthy();
  });

  it('hides the pill when there is no active model', () => {
    runInAction(() => {
      modelStore.activeModelId = undefined;
    });
    const {queryByTestId} = render(<ChatScreen />, {withNavigation: true});
    expect(queryByTestId('internet-toggle')).toBeNull();
  });

  it('starts OFF for a user who never set search up', () => {
    const {getByTestId} = render(<ChatScreen />, {withNavigation: true});
    expect(getByTestId('internet-toggle').props.accessibilityState).toEqual({
      checked: false,
    });
  });

  it('starts ON for a user who had already enabled search (toggle never touched)', () => {
    setSearch({consent: true, key: true, toggle: null});
    const {getByTestId} = render(<ChatScreen />, {withNavigation: true});
    expect(getByTestId('internet-toggle').props.accessibilityState).toEqual({
      checked: true,
    });
  });

  it('when search is not set up, pressing explains how to enable it and changes nothing', () => {
    const {getByTestId} = render(<ChatScreen />, {withNavigation: true});

    fireEvent.press(getByTestId('internet-toggle'));

    expect(uiStore.setChatWarning).toHaveBeenCalledTimes(1);
    expect((uiStore.setChatWarning as jest.Mock).mock.calls[0][0]).toEqual(
      expect.objectContaining({
        message: l10n.en.chat.internetNotSetUp,
        severity: 'warning',
      }),
    );
    expect(searchProviderStore.setInternetEnabled).not.toHaveBeenCalled();
    expect(getByTestId('internet-toggle').props.accessibilityState).toEqual({
      checked: false,
    });
  });

  it('consent without a key is still "not set up"', () => {
    setSearch({consent: true, key: false, toggle: null});
    const {getByTestId} = render(<ChatScreen />, {withNavigation: true});
    fireEvent.press(getByTestId('internet-toggle'));
    expect(uiStore.setChatWarning).toHaveBeenCalledTimes(1);
    expect(searchProviderStore.setInternetEnabled).not.toHaveBeenCalled();
  });

  it('when set up and OFF, pressing turns it ON', async () => {
    setSearch({consent: true, key: true, toggle: false});
    const {getByTestId} = render(<ChatScreen />, {withNavigation: true});

    await act(async () => {
      fireEvent.press(getByTestId('internet-toggle'));
    });

    expect(searchProviderStore.setInternetEnabled).toHaveBeenCalledWith(true);
    expect(uiStore.setChatWarning).not.toHaveBeenCalled();
    expect(getByTestId('internet-toggle').props.accessibilityState).toEqual({
      checked: true,
    });
  });

  it('when ON, pressing turns it OFF', async () => {
    setSearch({consent: true, key: true, toggle: true});
    const {getByTestId} = render(<ChatScreen />, {withNavigation: true});

    await act(async () => {
      fireEvent.press(getByTestId('internet-toggle'));
    });

    expect(searchProviderStore.setInternetEnabled).toHaveBeenCalledWith(false);
    expect(getByTestId('internet-toggle').props.accessibilityState).toEqual({
      checked: false,
    });
  });

  it('can be flipped on, off and on again', async () => {
    setSearch({consent: true, key: true, toggle: false});
    const {getByTestId} = render(<ChatScreen />, {withNavigation: true});
    const checked = () =>
      getByTestId('internet-toggle').props.accessibilityState.checked;

    for (const expected of [true, false, true]) {
      await act(async () => {
        fireEvent.press(getByTestId('internet-toggle'));
      });
      expect(checked()).toBe(expected);
    }
  });

  it('follows the store when search is switched off elsewhere (e.g. consent revoked)', async () => {
    setSearch({consent: true, key: true, toggle: true});
    const {getByTestId} = render(<ChatScreen />, {withNavigation: true});
    expect(
      getByTestId('internet-toggle').props.accessibilityState.checked,
    ).toBe(true);

    await act(async () => {
      runInAction(() => {
        mockStore.hasConsentedToSearch = false;
      });
    });

    expect(
      getByTestId('internet-toggle').props.accessibilityState.checked,
    ).toBe(false);
  });

  describe('tool-compatibility banner', () => {
    const noCapsContext = () => {
      const ctx = new LlamaContext(mockLlamaContextParams);
      (ctx as any).model = {
        ...mockLlamaContextParams.model,
        chatTemplates: {
          llamaChat: false,
          jinja: {
            default: true,
            defaultCaps: {
              tools: false,
              toolCalls: false,
              systemRole: false,
              parallelToolCalls: false,
            },
            toolUse: false,
            toolUseCaps: undefined,
          },
        },
      };
      return ctx;
    };

    beforeEach(() => {
      (uiStore.hasWarnedToolCompat as jest.Mock).mockReturnValue(false);
      runInAction(() => {
        modelStore.context = noCapsContext();
      });
      palStore.pals = [];
    });

    it('warns that the model cannot call tools when Internet is ON and the template has no tool support', () => {
      setSearch({consent: true, key: true, toggle: true});
      render(<ChatScreen />, {withNavigation: true});
      expect(uiStore.setChatWarning).toHaveBeenCalledTimes(1);
    });

    it('stays quiet when Internet is OFF (no tools are being sent)', () => {
      setSearch({consent: true, key: true, toggle: false});
      render(<ChatScreen />, {withNavigation: true});
      expect(uiStore.setChatWarning).not.toHaveBeenCalled();
    });
  });
});
