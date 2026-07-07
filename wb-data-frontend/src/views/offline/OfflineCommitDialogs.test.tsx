import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { OfflineCommitDialogs, type CommitMode } from './OfflineCommitDialogs';

function renderDialogs(overrides: Partial<Parameters<typeof OfflineCommitDialogs>[0]> = {}) {
    const props = {
        flowCommitOpen: false,
        repoCommitOpen: false,
        commitMessage: '',
        committing: false,
        flowDraftDirty: false,
        flowCommitDirty: false,
        repoDraftDirty: false,
        repoDirty: false,
        onFlowCommitOpenChange: vi.fn(),
        onRepoCommitOpenChange: vi.fn(),
        onCommitMessageChange: vi.fn(),
        onCommitFlow: vi.fn(),
        onCommitRepo: vi.fn(),
        ...overrides,
    };
    render(<OfflineCommitDialogs {...props} />);
    return props;
}

describe('OfflineCommitDialogs', () => {
    it('commits a dirty current Flow with save-and-commit from the primary action', () => {
        const props = renderDialogs({
            flowCommitOpen: true,
            commitMessage: 'save current draft',
            flowDraftDirty: true,
            flowCommitDirty: true,
        });

        const dialog = screen.getByRole('dialog', { name: '提交改动' });
        expect(within(dialog).getByRole('button', { name: '仅提交已保存内容' })).toBeTruthy();

        fireEvent.click(within(dialog).getByRole('button', { name: '保存并提交' }));

        expect(props.onCommitFlow).toHaveBeenCalledWith('save-and-commit' satisfies CommitMode);
    });

    it('commits saved current Flow content with saved-only from the secondary action', () => {
        const props = renderDialogs({
            flowCommitOpen: true,
            commitMessage: 'commit saved content',
            flowDraftDirty: true,
            flowCommitDirty: true,
        });

        fireEvent.click(within(screen.getByRole('dialog', { name: '提交改动' })).getByRole('button', { name: '仅提交已保存内容' }));

        expect(props.onCommitFlow).toHaveBeenCalledWith('saved-only' satisfies CommitMode);
    });

    it('commits a clean current Flow with saved-only from the primary action', () => {
        const props = renderDialogs({
            flowCommitOpen: true,
            commitMessage: 'commit saved flow',
            flowDraftDirty: false,
            flowCommitDirty: true,
        });

        const dialog = screen.getByRole('dialog', { name: '提交改动' });
        expect(within(dialog).queryByRole('button', { name: '仅提交已保存内容' })).toBeNull();

        fireEvent.click(within(dialog).getByRole('button', { name: '提交' }));

        expect(props.onCommitFlow).toHaveBeenCalledWith('saved-only' satisfies CommitMode);
    });

    it('routes repository commit mode from the selected action', () => {
        const props = renderDialogs({
            repoCommitOpen: true,
            commitMessage: 'repo commit',
            repoDraftDirty: true,
            repoDirty: true,
        });

        const dialog = screen.getByRole('dialog', { name: '提交仓库' });
        fireEvent.click(within(dialog).getByRole('button', { name: '仅提交已保存内容' }));
        fireEvent.click(within(dialog).getByRole('button', { name: '保存并提交' }));

        expect(props.onCommitRepo).toHaveBeenNthCalledWith(1, 'saved-only' satisfies CommitMode);
        expect(props.onCommitRepo).toHaveBeenNthCalledWith(2, 'save-and-commit' satisfies CommitMode);
    });

    it('disables commit actions while committing or before a message is entered', () => {
        const blankProps = renderDialogs({
            flowCommitOpen: true,
            commitMessage: '   ',
            flowDraftDirty: true,
            flowCommitDirty: true,
        });

        const blankDialog = screen.getByRole('dialog', { name: '提交改动' });
        expect((within(blankDialog).getByRole('button', { name: '保存并提交' }) as HTMLButtonElement).disabled).toBe(true);
        expect((within(blankDialog).getByRole('button', { name: '仅提交已保存内容' }) as HTMLButtonElement).disabled).toBe(true);
        expect(blankProps.onCommitFlow).not.toHaveBeenCalled();
    });
});
