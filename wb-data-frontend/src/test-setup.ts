import { vi } from 'vitest';

// jsdom does not ship ResizeObserver — react-resizable-panels needs it
global.ResizeObserver = vi.fn().mockImplementation(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
}));
