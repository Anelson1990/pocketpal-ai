import React from 'react';

import {
  fireEvent,
  render as baseRender,
  act,
} from '../../../../jest/test-utils';

import {SettingsScreen} from '../SettingsScreen';

import {searchProviderStore} from '../../../store';
import {l10n} from '../../../locales';

jest.useFakeTimers();

const render = (ui: React.ReactElement, options: any = {}) =>
  baseRender(ui, {withBottomSheetProvider: true, ...options});

describe('SettingsScreen — tool-call limit (Internet Search)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const renderScreen = () =>
    render(<SettingsScreen />, {withSafeArea: true, withNavigation: true});

  it('shows the control with its label and an accessible range', () => {
    const {getByTestId, getByText} = renderScreen();
    const slider = getByTestId('search-max-tool-calls-slider');

    expect(
      getByText(l10n.en.settings.internetSearch.maxToolCallsLabel),
    ).toBeTruthy();
    expect(
      getByText(l10n.en.settings.internetSearch.maxToolCallsDescription),
    ).toBeTruthy();
    expect(slider.props.accessibilityLabel).toBe(
      l10n.en.settings.internetSearch.maxToolCallsLabel,
    );
    expect(slider.props.accessibilityValue).toEqual(
      expect.objectContaining({min: 1, max: 10}),
    );
  });

  it('writes the chosen value to the store (after the slider’s debounce)', () => {
    const {getByTestId} = renderScreen();

    act(() => {
      fireEvent(getByTestId('search-max-tool-calls-slider'), 'valueChange', 8);
    });
    act(() => {
      jest.advanceTimersByTime(300);
    });

    expect(searchProviderStore.setMaxToolCalls).toHaveBeenCalledWith(8);
  });

  it('rounds a fractional slider value to a whole number of calls', () => {
    const {getByTestId} = renderScreen();

    act(() => {
      fireEvent(
        getByTestId('search-max-tool-calls-slider'),
        'valueChange',
        3.6,
      );
    });
    act(() => {
      jest.advanceTimersByTime(300);
    });

    expect(searchProviderStore.setMaxToolCalls).toHaveBeenCalledWith(4);
  });

  it('is independent of the result-count slider', () => {
    const {getByTestId} = renderScreen();

    act(() => {
      fireEvent(getByTestId('search-result-count-slider'), 'valueChange', 2);
    });
    act(() => {
      jest.advanceTimersByTime(300);
    });

    expect(searchProviderStore.setResultCount).toHaveBeenCalledWith(2);
    expect(searchProviderStore.setMaxToolCalls).not.toHaveBeenCalled();
  });
});
