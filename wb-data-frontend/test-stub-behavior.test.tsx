import { act, fireEvent, render, screen, cleanup } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import GitSettingsTab from './src/views/group-settings/GitSettingsTab';

const { getGitConfig, deleteGitConfig } = vi.hoisted(() => ({
  getGitConfig: vi.fn(),
  deleteGitConfig: vi.fn(),
}));

vi.mock('./src/views/group-settings/gitSettingsApi', () => ({
  getGitConfig,
  deleteGitConfig,
}));

getGitConfig.mockResolvedValue({ provider: 'github', username: 'alice', baseUrl: 'https://github.com', tokenMasked: true });

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeAll(() => {
  (window as any).confirm = vi.fn(() => true);
});

function renderWithQuery(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('stub behavior verification', () => {
  it('deleteGitConfig is called when window.confirm is stubbed to return true', async () => {
    deleteGitConfig.mockResolvedValueOnce(undefined);
    
    renderWithQuery(<GitSettingsTab groupId={1} />);
    
    const deleteBtn = await screen.findByRole('button', { name: /删除配置/ });
    
    fireEvent.click(deleteBtn);
    
    // Since window.confirm returns true, deleteGitConfig should be called
    expect(deleteGitConfig).toHaveBeenCalledTimes(1);
  });
});
