import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const localStorageStub = {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
    key: vi.fn(() => null),
    length: 0,
};

describe('GroupForm', () => {
    beforeEach(() => {
        vi.stubGlobal('localStorage', localStorageStub);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });

    it('renders the optional remote repository section in create mode', async () => {
        const { default: GroupForm } = await import('./GroupForm');

        render(
            <GroupForm
                open
                onOpenChange={() => {}}
                onSuccess={() => {}}
            />,
        );

        expect(screen.getByRole('heading', { name: '新建项目组' })).toBeTruthy();
        expect(screen.getByRole('button', { name: '高级配置：远程仓库（可选）' })).toBeTruthy();
    });
});
