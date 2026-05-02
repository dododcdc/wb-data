import { act, fireEvent, render, screen, waitFor, within, cleanup } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import GitSettingsTab from './GitSettingsTab';

const { getGitConfig, deleteGitConfig } = vi.hoisted(() => ({
  getGitConfig: vi.fn(),
  deleteGitConfig: vi.fn(),
}));

vi.mock('./gitSettingsApi', () => ({
  getGitConfig,
  deleteGitConfig,
}));

// Default resolved value so react-query doesn't error if the query fires before a test's mockResolvedValueOnce
getGitConfig.mockResolvedValue({ provider: 'github', username: 'alice', baseUrl: 'https://github.com', tokenMasked: true });

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

beforeAll(() => {
  // stub window.confirm to avoid jsdom 'Not implemented' error and prevent crash when code calls window.confirm
  // return true so user confirms by default; tests still expect an in-app dialog which production doesn't render
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).confirm = vi.fn(() => true);
});

function renderWithQuery(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('GitSettingsTab - confirm dialog behavior (spec tests)', () => {
  it('opens a confirm dialog when delete is triggered (expected to fail until dialog is implemented)', async () => {
    getGitConfig.mockResolvedValueOnce({ provider: 'github', username: 'alice', baseUrl: 'https://github.com', tokenMasked: true });

    renderWithQuery(<GitSettingsTab groupId={1} />);

    // Delete button should be present
    const deleteBtn = await screen.findByRole('button', { name: /删除配置/ });
    fireEvent.click(deleteBtn);

    // When in-app confirm dialog is implemented this should find the dialog.
    // Currently the production code uses window.confirm and so this will fail.
    await screen.findByRole('dialog');
  });

  it('clicking confirm disables actions and keeps dialog open while delete is pending', async () => {
    getGitConfig.mockResolvedValueOnce({ provider: 'github', username: 'alice', baseUrl: 'https://github.com', tokenMasked: true });

    const deferred = createDeferred<void>();
    deleteGitConfig.mockReturnValueOnce(deferred.promise);

    renderWithQuery(<GitSettingsTab groupId={1} />);

    const deleteBtn = await screen.findByRole('button', { name: /删除配置/ });
    fireEvent.click(deleteBtn);

    const dialog = await screen.findByRole('dialog');
    const confirmBtn = within(dialog).getByRole('button', { name: /确认/ });
    const cancelBtn = within(dialog).getByRole('button', { name: /取消/ });

    // Click confirm to start delete
    fireEvent.click(confirmBtn);

    // While delete is pending both buttons should be disabled and the dialog should remain open
    await waitFor(() => expect(confirmBtn.disabled).toBeTruthy());
    expect(cancelBtn.disabled).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();

    // Attempt to dismiss the dialog while delete is pending (Escape key)
    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape', keyCode: 27 });
    // dialog should remain open while delete is pending
    expect(screen.getByRole('dialog')).toBeTruthy();

    // If there is a backdrop element (parent of dialog), attempt a backdrop click
    const backdrop = dialog.parentElement;
    if (backdrop && backdrop !== document.body) {
      fireEvent.mouseDown(backdrop);
      fireEvent.click(backdrop);
      expect(screen.getByRole('dialog')).toBeTruthy();
    }

    // cleanup: resolve to avoid hanging promises
    act(() => {
      deferred.resolve();
    });

    // After success, dialog should be closed
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('retries delete via the dialog confirm button (not by re-clicking outer trigger)', async () => {
    getGitConfig.mockResolvedValueOnce({ provider: 'github', username: 'alice', baseUrl: 'https://github.com', tokenMasked: true });

    const first = createDeferred<void>();
    const second = createDeferred<void>();
    deleteGitConfig
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    renderWithQuery(<GitSettingsTab groupId={1} />);

    const deleteBtn = await screen.findByRole('button', { name: /删除配置/ });
    fireEvent.click(deleteBtn);

    const dialog = await screen.findByRole('dialog');
    const confirmBtn = within(dialog).getByRole('button', { name: /确认/ });

    // First attempt
    fireEvent.click(confirmBtn);
    await waitFor(() => expect(confirmBtn.disabled).toBeTruthy());

    // Simulate failure
    act(() => {
      first.reject(new Error('delete failed'));
    });

    // After failure, dialog should still be visible and allow retry via the confirm button
    await waitFor(() => expect(confirmBtn.disabled).toBeFalsy());
    // dialog remains open after failure
    expect(screen.getByRole('dialog')).toBeTruthy();

    // Retry via dialog confirm button
    fireEvent.click(confirmBtn);
    await waitFor(() => expect(confirmBtn.disabled).toBeTruthy());

    // cleanup: resolve second
    act(() => {
      second.resolve();
    });

    // After success, dialog should be closed
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
