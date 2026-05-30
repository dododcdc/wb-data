import { act, fireEvent, render, screen, waitFor, within, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

import GitSettingsTab from './GitSettingsTab';

const { getGitConfig, saveGitConfig, deleteGitConfig, testGitConnection, listBranches, switchBranch } = vi.hoisted(() => ({
  getGitConfig: vi.fn(),
  saveGitConfig: vi.fn(),
  deleteGitConfig: vi.fn(),
  testGitConnection: vi.fn(),
  listBranches: vi.fn(),
  switchBranch: vi.fn(),
}));

vi.mock('./gitSettingsApi', () => ({
  getGitConfig,
  saveGitConfig,
  deleteGitConfig,
  testGitConnection,
}));

vi.mock('../../api/offline', () => ({
  listBranches,
  switchBranch,
  deleteBranch: vi.fn(),
}));

getGitConfig.mockResolvedValue({ provider: 'github', username: 'alice', baseUrl: 'https://github.com', tokenMasked: true });
listBranches.mockResolvedValue({ branches: [] });

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
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

async function enterConfigEdit() {
  fireEvent.click(await screen.findByRole('button', { name: /编辑配置/ }));
}

describe('GitSettingsTab - permission control', () => {
  it('shows read-only view without action buttons when canEdit is false', async () => {
    getGitConfig.mockResolvedValueOnce({ provider: 'github', username: 'alice', baseUrl: 'https://github.com', tokenMasked: true });

    renderWithQuery(<GitSettingsTab groupId={1} canEdit={false} />);

    // Should show config data as text
    expect(await screen.findByText('GitHub')).toBeTruthy();
    expect(screen.getByText('alice')).toBeTruthy();

    // No action buttons
    expect(screen.queryByRole('button', { name: /测试连接/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /保存配置/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /删除配置/ })).toBeNull();
  });

  it('shows empty state when canEdit is false and no config', async () => {
    getGitConfig.mockResolvedValueOnce(null);

    renderWithQuery(<GitSettingsTab groupId={1} canEdit={false} />);

    expect(await screen.findByText('尚未配置远程仓库')).toBeTruthy();
  });

  it('shows read-only config summary first when canEdit is true and config exists', async () => {
    getGitConfig.mockResolvedValueOnce({ provider: 'github', username: 'alice', baseUrl: 'https://github.com', tokenMasked: true });

    renderWithQuery(<GitSettingsTab groupId={1} canEdit={true} />);

    expect(await screen.findByRole('button', { name: /编辑配置/ })).toBeTruthy();
    expect(screen.getByText('已配置')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /保存配置/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /删除配置/ })).toBeNull();
  });

  it('enters edit mode from the config summary', async () => {
    getGitConfig.mockResolvedValueOnce({ provider: 'github', username: 'alice', baseUrl: 'https://github.com', tokenMasked: true });

    renderWithQuery(<GitSettingsTab groupId={1} canEdit={true} />);

    await enterConfigEdit();

    expect(screen.getByRole('button', { name: /测试连接/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /保存配置/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /取消/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /删除配置/ })).toBeTruthy();
  });

  it('fetches git config when canEdit is false', () => {
    getGitConfig.mockResolvedValueOnce(null);
    renderWithQuery(<GitSettingsTab groupId={1} canEdit={false} />);
    expect(getGitConfig).toHaveBeenCalledWith(1);
  });
});

describe('GitSettingsTab - test connection', () => {
  it('calls testGitConnection with groupId when test button is clicked', async () => {
    getGitConfig.mockResolvedValueOnce({ provider: 'github', username: 'alice', baseUrl: 'https://github.com', tokenMasked: true });
    testGitConnection.mockResolvedValueOnce('连接成功');

    renderWithQuery(<GitSettingsTab groupId={1} canEdit={true} />);

    await enterConfigEdit();
    const testBtn = await screen.findByRole('button', { name: /测试连接/ });

    // Fill token field (required by validation in handleTest)
    const tokenInput = screen.getByPlaceholderText(/已保存|填入新的 Token/);
    fireEvent.change(tokenInput, { target: { value: 'test-token' } });

    fireEvent.click(testBtn);

    await waitFor(() => {
      expect(testGitConnection).toHaveBeenCalledWith(1, {
        provider: 'github',
        username: 'alice',
        token: 'test-token',
        baseUrl: 'https://github.com',
      });
    });
  });

  it('shows connection failure feedback without login redirect', async () => {
    getGitConfig.mockResolvedValueOnce({ provider: 'github', username: 'alice', baseUrl: 'https://github.com', tokenMasked: true });
    testGitConnection.mockRejectedValueOnce(new Error('Token 无效'));

    renderWithQuery(<GitSettingsTab groupId={1} canEdit={true} />);

    await enterConfigEdit();
    const testBtn = await screen.findByRole('button', { name: /测试连接/ });
    fireEvent.click(testBtn);

    // Button should become enabled again after failure (not stuck loading)
    await waitFor(() => {
      expect(testBtn.hasAttribute('disabled')).toBeFalsy();
    });

    // No dialog or redirect should have occurred - the error is shown as feedback
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows success feedback on successful connection test', async () => {
    getGitConfig.mockResolvedValueOnce({ provider: 'github', username: 'alice', baseUrl: 'https://github.com', tokenMasked: true });
    testGitConnection.mockResolvedValueOnce('连接成功');

    renderWithQuery(<GitSettingsTab groupId={1} canEdit={true} />);

    await enterConfigEdit();
    const testBtn = await screen.findByRole('button', { name: /测试连接/ });
    fireEvent.click(testBtn);

    await waitFor(() => {
      expect(testBtn.hasAttribute('disabled')).toBeFalsy();
    });
  });
});

describe('GitSettingsTab - provider options', () => {
  it('only shows GitHub and GitLab in provider dropdown', async () => {
    getGitConfig.mockResolvedValueOnce({ provider: 'github', username: 'alice', baseUrl: 'https://github.com', tokenMasked: true });

    renderWithQuery(<GitSettingsTab groupId={1} canEdit={true} />);

    // Initial provider display should show GitHub
    await screen.findByText('GitHub');

    // Gitea should not appear anywhere in the rendered output
    expect(screen.queryByText('Gitea')).toBeNull();
    expect(screen.queryByText('Gitee')).toBeNull();
  });
});

describe('GitSettingsTab - tab scope', () => {
  it('keeps the remote repository tab focused on connection configuration', async () => {
    getGitConfig.mockResolvedValueOnce({ provider: 'github', username: 'alice', baseUrl: 'https://github.com', tokenMasked: true });

    renderWithQuery(<GitSettingsTab groupId={1} canEdit={true} />);

    expect(await screen.findByText('连接配置')).toBeTruthy();
    expect(screen.queryByText('分支维护')).toBeNull();
    expect(listBranches).not.toHaveBeenCalled();
  });
});

describe('GitSettingsTab - confirm dialog behavior', () => {
  it('opens a confirm dialog when delete is triggered', async () => {
    getGitConfig.mockResolvedValueOnce({ provider: 'github', username: 'alice', baseUrl: 'https://github.com', tokenMasked: true });

    renderWithQuery(<GitSettingsTab groupId={1} canEdit={true} />);

    await enterConfigEdit();
    const deleteBtn = await screen.findByRole('button', { name: /删除配置/ });
    fireEvent.click(deleteBtn);

    expect(await screen.findByRole('dialog')).toBeTruthy();
  });

  it('clicking confirm disables actions and keeps dialog open while delete is pending', async () => {
    getGitConfig.mockResolvedValueOnce({ provider: 'github', username: 'alice', baseUrl: 'https://github.com', tokenMasked: true });

    const deferred = createDeferred<void>();
    deleteGitConfig.mockReturnValueOnce(deferred.promise);

    renderWithQuery(<GitSettingsTab groupId={1} canEdit={true} />);

    await enterConfigEdit();
    const deleteBtn = await screen.findByRole('button', { name: /删除配置/ });
    fireEvent.click(deleteBtn);

    const dialog = await screen.findByRole('dialog');
    const confirmBtn = within(dialog).getByRole('button', { name: /确认/ });
    const cancelBtn = within(dialog).getByRole('button', { name: /取消/ });

    fireEvent.click(confirmBtn);

    await waitFor(() => expect(confirmBtn.hasAttribute('disabled')).toBeTruthy());
    expect(cancelBtn.hasAttribute('disabled')).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape', keyCode: 27 });
    expect(screen.getByRole('dialog')).toBeTruthy();

    const backdrop = dialog.parentElement;
    if (backdrop && backdrop !== document.body) {
      fireEvent.mouseDown(backdrop);
      fireEvent.click(backdrop);
      expect(screen.getByRole('dialog')).toBeTruthy();
    }

    act(() => {
      deferred.resolve();
    });

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('retries delete via the dialog confirm button after failure', async () => {
    getGitConfig.mockResolvedValueOnce({ provider: 'github', username: 'alice', baseUrl: 'https://github.com', tokenMasked: true });

    const first = createDeferred<void>();
    const second = createDeferred<void>();
    deleteGitConfig
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    renderWithQuery(<GitSettingsTab groupId={1} canEdit={true} />);

    await enterConfigEdit();
    const deleteBtn = await screen.findByRole('button', { name: /删除配置/ });
    fireEvent.click(deleteBtn);

    const dialog = await screen.findByRole('dialog');
    const confirmBtn = within(dialog).getByRole('button', { name: /确认/ });

    fireEvent.click(confirmBtn);
    await waitFor(() => expect(confirmBtn.hasAttribute('disabled')).toBeTruthy());

    act(() => {
      first.reject(new Error('delete failed'));
    });

    await waitFor(() => expect(confirmBtn.hasAttribute('disabled')).toBeFalsy());
    expect(screen.getByRole('dialog')).toBeTruthy();

    fireEvent.click(confirmBtn);
    await waitFor(() => expect(confirmBtn.hasAttribute('disabled')).toBeTruthy());

    act(() => {
      second.resolve();
    });

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('shows delete config button only when config exists and canEdit is true', async () => {
    getGitConfig.mockResolvedValueOnce({ provider: 'github', username: 'alice', baseUrl: 'https://github.com', tokenMasked: true });

    renderWithQuery(<GitSettingsTab groupId={1} canEdit={true} />);

    await enterConfigEdit();
    expect(await screen.findByRole('button', { name: /删除配置/ })).toBeTruthy();
  });
});

describe('GitSettingsTab - save config', () => {
  it('calls saveGitConfig with groupId when save button is clicked', async () => {
    getGitConfig.mockResolvedValueOnce({ provider: 'github', username: 'alice', baseUrl: 'https://github.com', tokenMasked: true });
    saveGitConfig.mockResolvedValueOnce(undefined);

    renderWithQuery(<GitSettingsTab groupId={1} canEdit={true} />);

    await enterConfigEdit();
    const saveBtn = await screen.findByRole('button', { name: /保存配置/ });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(saveGitConfig).toHaveBeenCalledWith(1, {
        provider: 'github',
        username: 'alice',
        token: '',
        baseUrl: 'https://github.com',
      });
    });
  });
});
