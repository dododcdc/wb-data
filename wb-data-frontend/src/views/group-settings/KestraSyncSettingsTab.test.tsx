import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import KestraSyncSettingsTab from './KestraSyncSettingsTab';

const {
  getGitConfig,
  getGitSyncConfigs,
  createGitSyncConfig,
  createAllGitSyncConfigs,
  triggerGitSyncConfig,
  deleteGitSyncConfig,
} = vi.hoisted(() => ({
  getGitConfig: vi.fn(),
  getGitSyncConfigs: vi.fn(),
  createGitSyncConfig: vi.fn(),
  createAllGitSyncConfigs: vi.fn(),
  triggerGitSyncConfig: vi.fn(),
  deleteGitSyncConfig: vi.fn(),
}));

vi.mock('./gitSettingsApi', () => ({
  getGitConfig,
  getGitSyncConfigs,
  createGitSyncConfig,
  createAllGitSyncConfigs,
  triggerGitSyncConfig,
  deleteGitSyncConfig,
}));

beforeEach(() => {
  getGitConfig.mockResolvedValue({ provider: 'github', username: 'alice', baseUrl: 'https://github.com', tokenMasked: true });
  getGitSyncConfigs.mockResolvedValue({
    configs: [],
    availableBranches: ['main', 'feature/policy-review'],
    syncCron: '*/5 * * * *',
  });
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

function renderWithQuery(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        {ui}
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('KestraSyncSettingsTab', () => {
  it('renders sync configs and exposes admin actions', async () => {
    getGitConfig.mockResolvedValueOnce({ provider: 'github', username: 'alice', baseUrl: 'https://github.com', tokenMasked: true });
    getGitSyncConfigs.mockResolvedValueOnce({
      configs: [
        {
          id: 7,
          groupId: 1,
          branch: 'main',
          namespace: 'g1-main',
          syncFlowId: 'sync-flows-g1-main',
          enabled: true,
          lastSyncAt: null,
          lastSyncStatus: null,
          lastSyncMessage: null,
        },
        {
          id: 8,
          groupId: 1,
          branch: 'feature/policy-review',
          namespace: 'g1-feature-policy-review',
          syncFlowId: 'sync-flows-g1-feature-policy-review',
          enabled: false,
          lastSyncAt: null,
          lastSyncStatus: null,
          lastSyncMessage: null,
        },
      ],
      availableBranches: ['main', 'feature/policy-review'],
      syncCron: '*/5 * * * *',
    });

    renderWithQuery(<KestraSyncSettingsTab groupId={1} canEdit={true} />);

    expect(await screen.findByText('main')).toBeTruthy();
    expect(screen.queryByText('g1-main')).toBeNull();
    expect(screen.getByRole('button', { name: '添加分支' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '同步全部分支' })).toBeTruthy();
    expect(screen.queryByText('自动检查：开启')).toBeNull();
    expect(screen.queryByText('上次同步：未执行')).toBeNull();
    expect(screen.getByRole('button', { name: '同步一次 main' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '移出同步 main' })).toBeNull();
    expect(screen.getByRole('button', { name: '移出同步 feature/policy-review' })).toBeTruthy();
  });

  it('does not expose sync bookkeeping statuses in the branch list', async () => {
    getGitConfig.mockResolvedValueOnce({ provider: 'github', username: 'alice', baseUrl: 'https://github.com', tokenMasked: true });
    getGitSyncConfigs.mockResolvedValueOnce({
      configs: [
        {
          id: 7,
          groupId: 1,
          branch: 'main',
          namespace: 'g1-main',
          syncFlowId: 'sync-flows-g1-main',
          enabled: true,
          lastSyncAt: null,
          lastSyncStatus: 'CREATED',
          lastSyncMessage: null,
        },
      ],
      availableBranches: ['main'],
      syncCron: '*/5 * * * *',
    });

    renderWithQuery(<KestraSyncSettingsTab groupId={1} canEdit={true} />);

    expect(await screen.findByText('main')).toBeTruthy();
    expect(screen.queryByText('CREATED')).toBeNull();
    expect(screen.queryByText('上次同步：等待执行')).toBeNull();
  });

  it('shows remote repository setup entry when git config is missing', async () => {
    const onConfigureGit = vi.fn();
    getGitConfig.mockResolvedValueOnce(null);

    renderWithQuery(<KestraSyncSettingsTab groupId={1} canEdit={true} onConfigureGit={onConfigureGit} />);

    expect(await screen.findByText('先连接远程仓库，再选择需要自动同步的分支。')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '配置远程仓库' }));

    expect(onConfigureGit).toHaveBeenCalled();
    expect(getGitSyncConfigs).not.toHaveBeenCalled();
  });

  it('adds the first unsynced branch by default', async () => {
    getGitConfig.mockResolvedValueOnce({ provider: 'github', username: 'alice', baseUrl: 'https://github.com', tokenMasked: true });
    createGitSyncConfig.mockResolvedValueOnce({
      id: 8,
      groupId: 1,
      branch: 'feature/policy-review',
      namespace: 'g1-feature-policy-review',
      syncFlowId: 'sync-flows-g1-feature-policy-review',
      enabled: true,
      lastSyncAt: null,
      lastSyncStatus: null,
      lastSyncMessage: null,
    });

    renderWithQuery(<KestraSyncSettingsTab groupId={1} canEdit={true} />);

    const addButton = await screen.findByRole('button', { name: '添加分支' });
    await waitFor(() => expect(addButton.hasAttribute('disabled')).toBeFalsy());
    fireEvent.click(addButton);

    await waitFor(() => {
      expect(createGitSyncConfig).toHaveBeenCalledWith(1, 'main');
    });
  });

  it('adds all known branches through the bulk action', async () => {
    getGitConfig.mockResolvedValueOnce({ provider: 'github', username: 'alice', baseUrl: 'https://github.com', tokenMasked: true });
    createAllGitSyncConfigs.mockResolvedValueOnce({ created: 2, existing: 1, configs: [] });

    renderWithQuery(<KestraSyncSettingsTab groupId={1} canEdit={true} />);

    fireEvent.click(await screen.findByRole('button', { name: '同步全部分支' }));

    await waitFor(() => {
      expect(createAllGitSyncConfigs).toHaveBeenCalledWith(1);
    });
  });

  it('routes sync row actions to the API', async () => {
    getGitConfig.mockResolvedValueOnce({ provider: 'github', username: 'alice', baseUrl: 'https://github.com', tokenMasked: true });
    getGitSyncConfigs.mockResolvedValue({
      configs: [
        {
          id: 7,
          groupId: 1,
          branch: 'main',
          namespace: 'g1-main',
          syncFlowId: 'sync-flows-g1-main',
          enabled: true,
          lastSyncAt: null,
          lastSyncStatus: null,
          lastSyncMessage: null,
        },
        {
          id: 8,
          groupId: 1,
          branch: 'feature/policy-review',
          namespace: 'g1-feature-policy-review',
          syncFlowId: 'sync-flows-g1-feature-policy-review',
          enabled: false,
          lastSyncAt: null,
          lastSyncStatus: null,
          lastSyncMessage: null,
        },
      ],
      availableBranches: ['main', 'feature/policy-review'],
      syncCron: '*/5 * * * *',
    });
    triggerGitSyncConfig.mockResolvedValueOnce({ id: 7, executionId: 'exec-1', status: 'CREATED', triggeredAt: null });
    deleteGitSyncConfig.mockResolvedValueOnce(undefined);

    renderWithQuery(<KestraSyncSettingsTab groupId={1} canEdit={true} />);

    fireEvent.click(await screen.findByRole('button', { name: '同步一次 main' }));
    await waitFor(() => expect(triggerGitSyncConfig).toHaveBeenCalledWith(1, 7));

    fireEvent.click(screen.getByRole('button', { name: '移出同步 feature/policy-review' }));
    await waitFor(() => expect(deleteGitSyncConfig).toHaveBeenCalledWith(1, 8));
  });

  it('hides sync mutation controls for read-only users', async () => {
    getGitConfig.mockResolvedValueOnce({ provider: 'github', username: 'alice', baseUrl: 'https://github.com', tokenMasked: true });
    getGitSyncConfigs.mockResolvedValueOnce({
      configs: [
        {
          id: 7,
          groupId: 1,
          branch: 'main',
          namespace: 'g1-main',
          syncFlowId: 'sync-flows-g1-main',
          enabled: true,
          lastSyncAt: null,
          lastSyncStatus: null,
          lastSyncMessage: null,
        },
      ],
      availableBranches: ['main'],
      syncCron: '*/5 * * * *',
    });

    renderWithQuery(<KestraSyncSettingsTab groupId={1} canEdit={false} />);

    expect(await screen.findByText('自动同步')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '同步全部分支' })).toBeNull();
    expect(screen.queryByRole('button', { name: '同步一次 main' })).toBeNull();
    expect(screen.queryByRole('button', { name: '移出同步 main' })).toBeNull();
  });
});
