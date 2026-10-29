// client/src/__tests__/authGuard.test.jsx
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from '../App';
import * as AuthContextModule from '../context/AuthContext';

describe('Auth Guard Verification', () => {
  it('renders login page when user is not authenticated', () => {
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      user: null,
      token: null,
      loading: false,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
    });

    render(<App />);
    expect(screen.getByText(/IoT Accident Detector/i)).toBeDefined();
    expect(screen.getByPlaceholderText(/you@example.com/i)).toBeDefined();
    expect(screen.getAllByRole('button', { name: /Sign In/i }).length).toBeGreaterThanOrEqual(1);
  });

  it('renders loading splash when authentication is resolving', () => {
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      user: null,
      token: null,
      loading: true,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
    });

    render(<App />);
    expect(screen.getByText(/Initialising…/i)).toBeDefined();
  });

  it('renders authenticated dashboard shell with sidebar when user is logged in', () => {
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      user: { name: 'Fleet Commander', email: 'admin@fleetlab.com' },
      token: 'mock-jwt-token-xyz',
      loading: false,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
    });

    render(<App />);
    expect(screen.getByText(/Fleet Commander/i)).toBeDefined();
    expect(screen.getByText(/Dashboard/i)).toBeDefined();
    expect(screen.getByText(/Simulator Control/i)).toBeDefined();
    expect(screen.getByText(/Incidents/i)).toBeDefined();
  });
});
