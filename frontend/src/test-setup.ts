import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// Browser media APIs are replaced explicitly so install tests are deterministic.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
