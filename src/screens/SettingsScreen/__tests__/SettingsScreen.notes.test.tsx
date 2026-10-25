import React from 'react';
import {Alert} from 'react-native';

import {
  fireEvent,
  render as baseRender,
  act,
  waitFor,
} from '../../../../jest/test-utils';

import {SettingsScreen} from '../SettingsScreen';

import {notesStore} from '../../../store';
import {l10n} from '../../../locales';

jest.useFakeTimers();

const render = (ui: React.ReactElement, options: any = {}) =>
  baseRender(ui, {withBottomSheetProvider: true, ...options});

const strings = l10n.en.settings.notesMemory;

describe('SettingsScreen — Notes memory', () => {
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    (notesStore as any).enabled = false;
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  afterEach(() => {
    alertSpy.mockRestore();
  });

  const renderScreen = () =>
    render(<SettingsScreen />, {withSafeArea: true, withNavigation: true});

  it('shows the switch OFF by default with an accessible label and explanation', () => {
    const {getByTestId, getByText} = renderScreen();
    const sw = getByTestId('notes-memory-switch');
    expect(sw.props.value).toBe(false);
    expect(sw.props.accessibilityLabel).toBe(strings.enableLabel);
    expect(getByText(strings.description)).toBeTruthy();
  });

  it('turning the switch on and off writes to the store', () => {
    const {getByTestId} = renderScreen();

    act(() => {
      fireEvent(getByTestId('notes-memory-switch'), 'valueChange', true);
    });
    expect(notesStore.setEnabled).toHaveBeenLastCalledWith(true);
    expect(getByTestId('notes-memory-switch').props.value).toBe(true);

    act(() => {
      fireEvent(getByTestId('notes-memory-switch'), 'valueChange', false);
    });
    expect(notesStore.setEnabled).toHaveBeenLastCalledWith(false);
    expect(getByTestId('notes-memory-switch').props.value).toBe(false);
  });

  it('Clear asks first and deletes nothing until confirmed', () => {
    const {getByTestId} = renderScreen();
    fireEvent.press(getByTestId('notes-clear-button'));

    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(alertSpy.mock.calls[0][0]).toBe(strings.clearTitle);
    expect(alertSpy.mock.calls[0][1]).toBe(strings.clearMessage);
    expect(notesStore.clearAll).not.toHaveBeenCalled();
  });

  it('cancelling the prompt keeps the notes', () => {
    const {getByTestId} = renderScreen();
    fireEvent.press(getByTestId('notes-clear-button'));

    const buttons = alertSpy.mock.calls[0][2] as any[];
    const cancel = buttons.find(b => b.style === 'cancel');
    cancel.onPress?.();

    expect(notesStore.clearAll).not.toHaveBeenCalled();
  });

  it('confirming deletes the notes and reports success', async () => {
    const {getByTestId} = renderScreen();
    fireEvent.press(getByTestId('notes-clear-button'));

    const buttons = alertSpy.mock.calls[0][2] as any[];
    const confirm = buttons.find(b => b.style === 'destructive');
    expect(confirm.text).toBe(strings.clearConfirm);
    await act(async () => {
      await confirm.onPress();
    });

    expect(notesStore.clearAll).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(alertSpy).toHaveBeenLastCalledWith(
        strings.clearTitle,
        strings.clearDone,
      ),
    );
  });

  it('reports a failed delete honestly', async () => {
    (notesStore.clearAll as jest.Mock).mockResolvedValueOnce(false);
    const {getByTestId} = renderScreen();
    fireEvent.press(getByTestId('notes-clear-button'));

    const confirm = (alertSpy.mock.calls[0][2] as any[]).find(
      b => b.style === 'destructive',
    );
    await act(async () => {
      await confirm.onPress();
    });

    expect(alertSpy).toHaveBeenLastCalledWith(
      strings.clearTitle,
      strings.clearFailed,
    );
  });
});
