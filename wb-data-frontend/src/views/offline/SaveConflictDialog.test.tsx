import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SaveConflictDialog } from './SaveConflictDialog';

describe('SaveConflictDialog', () => {
    it('asks for confirmation before calling onOverwrite', () => {
        const onOverwrite = vi.fn();
        render(
            <SaveConflictDialog
                open
                pending={false}
                onOpenChange={() => {}}
                onOverwrite={onOverwrite}
                onDiscardAndReload={() => {}}
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: '用我的覆盖' }));
        expect(onOverwrite).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: '确认覆盖保存' }));
        expect(onOverwrite).toHaveBeenCalledTimes(1);
    });

    it('routes cancel actions through onOpenChange(false)', () => {
        const onOpenChange = vi.fn();
        render(
            <SaveConflictDialog
                open
                pending={false}
                onOpenChange={onOpenChange}
                onOverwrite={() => {}}
                onDiscardAndReload={() => {}}
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: '稍后处理' }));
        expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it('routes the close button through onOpenChange(false)', () => {
        const onOpenChange = vi.fn();
        render(
            <SaveConflictDialog
                open
                pending={false}
                onOpenChange={onOpenChange}
                onOverwrite={() => {}}
                onDiscardAndReload={() => {}}
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: '关闭' }));
        expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it('calls onDiscardAndReload directly', () => {
        const onDiscardAndReload = vi.fn();
        render(
            <SaveConflictDialog
                open
                pending={false}
                onOpenChange={() => {}}
                onOverwrite={() => {}}
                onDiscardAndReload={onDiscardAndReload}
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: '丢弃本地并加载服务器' }));
        expect(onDiscardAndReload).toHaveBeenCalledTimes(1);
    });
});
