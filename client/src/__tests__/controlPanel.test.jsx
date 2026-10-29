// client/src/__tests__/controlPanel.test.jsx
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SimulatorPage from '../pages/SimulatorPage';
import axios from 'axios';

vi.mock('axios');

describe('Simulator Control Panel Verification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders virtual vehicle fleet and status cards', () => {
    render(<SimulatorPage />);

    expect(screen.getByText(/Virtual ESP32 Simulator Control/i)).toBeDefined();
    expect(screen.getByText(/Vehicle #1 \(Sedan\)/i)).toBeDefined();
    expect(screen.getByText(/Vehicle #2 \(SUV\)/i)).toBeDefined();
    expect(screen.getByText(/Vehicle #3 \(Van\)/i)).toBeDefined();
    expect(screen.getAllByText(/Buzzer: OFF/i).length).toBe(3);
  });

  it('allows selecting target vehicle and scenario from control panel', () => {
    render(<SimulatorPage />);

    // Click vehicle #2
    const vehicle2 = screen.getByText(/Vehicle #2 \(SUV\)/i);
    fireEvent.click(vehicle2);
    expect(screen.getByText(/Select Scenario for ESP32-SIM-002/i)).toBeDefined();

    // Click scenario Rollover
    const rolloverCard = screen.getByText(/Vehicle Rollover/i);
    fireEvent.click(rolloverCard);
    expect(screen.getByText(/● Selected/i)).toBeDefined();
  });

  it('dispatches scenario trigger request on button click', async () => {
    axios.post.mockResolvedValueOnce({ data: { success: true } });

    render(<SimulatorPage />);

    const triggerBtn = screen.getByRole('button', { name: /⚡ Trigger Scenario/i });
    expect(triggerBtn).toBeDefined();

    fireEvent.click(triggerBtn);

    await waitFor(() => {
      expect(axios.post).toHaveBeenCalledWith(
        'http://localhost:5055/scenario',
        expect.objectContaining({
          deviceId: 'ESP32-SIM-001',
          scenario: 'frontal_collision',
        })
      );
    });
  });

  it('dispatches driver false-alarm cancel request on button click', async () => {
    axios.post.mockResolvedValueOnce({ data: { success: true } });

    render(<SimulatorPage />);

    const cancelBtn = screen.getByRole('button', { name: /🔕 Driver Cancel \(False Alarm\)/i });
    expect(cancelBtn).toBeDefined();

    fireEvent.click(cancelBtn);

    await waitFor(() => {
      expect(axios.post).toHaveBeenCalledWith(
        'http://localhost:5055/cancel',
        expect.objectContaining({
          deviceId: 'ESP32-SIM-001',
        })
      );
    });
  });
});
