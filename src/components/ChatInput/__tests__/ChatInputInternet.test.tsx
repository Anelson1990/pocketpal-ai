/**
 * Tests for the ChatInput Internet toggle pill
 */

import React from 'react';
import {render, fireEvent} from '@testing-library/react-native';
import {ChatInput} from '../ChatInput';
import {UserContext} from '../../../utils';

// Mock the theme hook
jest.mock('../../../hooks', () => ({
  useTheme: () => ({
    colors: {
      primary: '#007AFF',
      onPrimary: '#FFFFFF',
      surface: '#FFFFFF',
      onSurface: '#000000',
      inverseOnSurface: '#FFFFFF',
      inverseSurface: '#000000',
      onSurfaceVariant: '#666666',
    },
    fonts: {
      inputTextStyle: {
        fontSize: 16,
        fontFamily: 'System',
      },
    },
  }),
  useVoiceCapture: () => ({
    start: jest.fn(),
    stop: jest.fn(),
    cancel: jest.fn(),
  }),
}));

// Mock the stores
jest.mock('../../../store', () => ({
  chatSessionStore: {
    activePalId: null,
  },
  modelStore: {
    activeModel: null,
  },
  palStore: {
    pals: [],
  },
  uiStore: {
    colorScheme: 'light',
  },
  asrStore: {
    captureState: 'idle',
  },
  ttsStore: {
    isTTSAvailable: false,
    currentVoice: null,
    autoSpeakEnabled: false,
    playbackState: {mode: 'idle'},
    openSetupSheet: jest.fn(),
    setAutoSpeak: jest.fn(),
  },
}));

// Mock the icons
jest.mock('../../../assets/icons', () => ({
  ChevronUpIcon: 'ChevronUpIcon',
  VideoRecorderIcon: 'VideoRecorderIcon',
  PlusIcon: 'PlusIcon',
  AtomIcon: 'AtomIcon',
  GlobeIcon: 'GlobeIcon',
}));

// Mock the components
jest.mock('../../SendButton', () => ({
  SendButton: 'SendButton',
}));

jest.mock('../../StopButton', () => ({
  StopButton: 'StopButton',
}));

jest.mock('../../Menu', () => ({
  Menu: {
    Item: 'MenuItem',
  },
}));

const mockUser = {
  id: 'test-user',
  firstName: 'Test',
  lastName: 'User',
};

describe('ChatInput Internet Toggle', () => {
  const defaultProps = {
    onSendPress: jest.fn(),
    onStopPress: jest.fn(),
    onPalBtnPress: jest.fn(),
    isStopVisible: false,
    sendButtonVisibilityMode: 'editing' as const,
    isPickerVisible: false,
    textInputProps: {},
  };

  const renderInput = (extra: Record<string, unknown>) =>
    render(
      <UserContext.Provider value={mockUser}>
        <ChatInput {...defaultProps} {...extra} />
      </UserContext.Provider>,
    );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('is not rendered unless showInternetToggle is true', () => {
    const {queryByTestId} = renderInput({
      showInternetToggle: false,
      isInternetEnabled: true,
      onInternetToggle: jest.fn(),
    });
    expect(queryByTestId('internet-toggle')).toBeNull();
  });

  it('is not rendered by default (existing screens are unchanged)', () => {
    const {queryByTestId} = renderInput({});
    expect(queryByTestId('internet-toggle')).toBeNull();
  });

  it('renders a labelled switch that is unchecked when Internet is off', () => {
    const {getByTestId, getByLabelText} = renderInput({
      showInternetToggle: true,
      isInternetEnabled: false,
      onInternetToggle: jest.fn(),
    });
    const pill = getByTestId('internet-toggle');
    expect(pill.props.accessibilityRole).toBe('switch');
    expect(pill.props.accessibilityState).toEqual({checked: false});
    expect(getByLabelText('Turn on internet access')).toBeTruthy();
  });

  it('renders as checked, with the opposite action as its label, when on', () => {
    const {getByTestId, getByLabelText, queryByLabelText} = renderInput({
      showInternetToggle: true,
      isInternetEnabled: true,
      onInternetToggle: jest.fn(),
    });
    expect(getByTestId('internet-toggle').props.accessibilityState).toEqual({
      checked: true,
    });
    expect(getByLabelText('Turn off internet access')).toBeTruthy();
    expect(queryByLabelText('Turn on internet access')).toBeNull();
  });

  it('shows a visible text label, not just an icon', () => {
    const {getByTestId} = renderInput({
      showInternetToggle: true,
      isInternetEnabled: false,
      onInternetToggle: jest.fn(),
    });
    expect(getByTestId('internet-toggle-label').props.children).toBe('Web');
  });

  it('calls onInternetToggle once per press and does not change state itself', () => {
    const onInternetToggle = jest.fn();
    const {getByTestId} = renderInput({
      showInternetToggle: true,
      isInternetEnabled: false,
      onInternetToggle,
    });
    fireEvent.press(getByTestId('internet-toggle'));
    expect(onInternetToggle).toHaveBeenCalledTimes(1);
    expect(getByTestId('internet-toggle').props.accessibilityState).toEqual({
      checked: false,
    });
  });

  it('does not crash when pressed without a handler', () => {
    const {getByTestId} = renderInput({
      showInternetToggle: true,
      isInternetEnabled: false,
    });
    expect(() => fireEvent.press(getByTestId('internet-toggle'))).not.toThrow();
  });

  it('sits alongside the thinking pill without replacing it', () => {
    const {getByTestId, getByLabelText} = renderInput({
      showThinkingToggle: true,
      isThinkingEnabled: false,
      onThinkingToggle: jest.fn(),
      showInternetToggle: true,
      isInternetEnabled: false,
      onInternetToggle: jest.fn(),
    });
    expect(getByLabelText('Enable thinking mode')).toBeTruthy();
    expect(getByTestId('internet-toggle')).toBeTruthy();
  });
});
