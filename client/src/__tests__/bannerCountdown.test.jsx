// client/src/__tests__/bannerCountdown.test.jsx
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import DashboardPage from '../pages/DashboardPage';
import * as socketModule from '../lib/socket';

describe('Emergency Countdown Banner Verification', () => {
  let socketCallbackMap = {};

  beforeEach(() => {
    socketCallbackMap = {};
    vi.spyOn(socketModule, 'useSocketEvent').mockImplementation((event, callback) => {
      socketCallbackMap[event] = callback;
    });
  });

  it('renders countdown banner when incident:pending event arrives', async () => {
    render(<DashboardPage />);

    // Initially no emergency banner
    expect(screen.queryByText(/CRASH DETECTED — CONFIRMATION COUNTDOWN/i)).toBeNull();

    // Trigger incident:pending event
    act(() => {
      if (socketCallbackMap['incident:pending']) {
        socketCallbackMap['incident:pending']({
          incidentId: 'INC-TEST-001',
          deviceId: 'ESP32-SIM-001',
          peakG: 9.8,
          confidence: 0.98,
          remainingSec: 15,
        });
      }
    });

    expect(screen.getByText(/CRASH DETECTED — CONFIRMATION COUNTDOWN/i)).toBeDefined();
    expect(screen.getByText(/ESP32-SIM-001/i)).toBeDefined();
    expect(screen.getByText(/15s/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /Cancel False Alarm/i })).toBeDefined();
  });

  it('transitions banner to EMERGENCY: CRASH CONFIRMED when countdown expires or incident confirmed', async () => {
    render(<DashboardPage />);

    act(() => {
      if (socketCallbackMap['incident:pending']) {
        socketCallbackMap['incident:pending']({
          incidentId: 'INC-TEST-002',
          deviceId: 'ESP32-SIM-002',
          peakG: 7.5,
          confidence: 0.95,
          remainingSec: 1,
        });
      }
    });

    expect(screen.getByText(/CRASH DETECTED — CONFIRMATION COUNTDOWN/i)).toBeDefined();

    // Trigger confirmed event
    act(() => {
      if (socketCallbackMap['incident:confirmed']) {
        socketCallbackMap['incident:confirmed']({
          _id: 'INC-TEST-002',
          deviceId: 'ESP32-SIM-002',
          peakG: 7.5,
          status: 'CONFIRMED',
        });
      }
    });

    expect(screen.getByText(/EMERGENCY: CRASH CONFIRMED/i)).toBeDefined();
    expect(screen.getByText(/Responders Dispatched/i)).toBeDefined();
  });

  it('removes emergency banner when incident:cancelled is emitted', () => {
    render(<DashboardPage />);

    act(() => {
      if (socketCallbackMap['incident:pending']) {
        socketCallbackMap['incident:pending']({
          incidentId: 'INC-TEST-003',
          deviceId: 'ESP32-SIM-003',
          peakG: 6.2,
          confidence: 0.92,
          remainingSec: 12,
        });
      }
    });

    expect(screen.getByText(/CRASH DETECTED — CONFIRMATION COUNTDOWN/i)).toBeDefined();

    act(() => {
      if (socketCallbackMap['incident:cancelled']) {
        socketCallbackMap['incident:cancelled']({
          incidentId: 'INC-TEST-003',
          reason: 'Driver false alarm',
        });
      }
    });

    expect(screen.queryByText(/CRASH DETECTED — CONFIRMATION COUNTDOWN/i)).toBeNull();
  });
});
