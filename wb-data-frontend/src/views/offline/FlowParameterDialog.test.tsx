import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FlowParameterBinding } from '../../api/offline';
import { getParameterGroup, getParameterGroupPage } from '../../api/parameterGroups';
import { FlowParameterDialog } from './FlowParameterDialog';

vi.mock('../../api/parameterGroups', async () => {
    const actual = await vi.importActual<typeof import('../../api/parameterGroups')>('../../api/parameterGroups');
    return {
        ...actual,
        getParameterGroupPage: vi.fn(),
        getParameterGroup: vi.fn(),
    };
});

vi.mock('../../components/SearchableCombobox', () => ({
    SearchableCombobox: ({
        value,
        options,
        onChange,
        id,
        ariaLabel,
        disabled,
        placeholder,
    }: {
        value?: string;
        options: { label: string; value: string }[];
        onChange: (val: string) => void;
        id?: string;
        ariaLabel?: string;
        disabled?: boolean;
        placeholder?: string;
    }) => (
        <select
            id={id}
            aria-label={ariaLabel}
            disabled={disabled}
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value)}
        >
            <option value="" disabled>
                {placeholder || '请选择'}
            </option>
            {options.map((option) => (
                <option key={option.value} value={option.value}>
                    {option.label}
                </option>
            ))}
        </select>
    ),
}));

const outdatedBinding: FlowParameterBinding = {
    parameterGroupId: 8,
    code: 'daily_common',
    name: '日常公共参数',
    boundVersion: 2,
    currentVersion: 3,
    status: 'OUTDATED',
    definitions: [{
        key: 'v_day',
        valueSource: 'SYSTEM_TIME',
        constantValue: null,
        format: 'yyyyMMdd',
        offsetDays: 0,
        timeBasis: 'PLANNED_TIME',
        description: null,
        sortOrder: 0,
    }],
};

describe('FlowParameterDialog', () => {
    beforeEach(() => {
        vi.mocked(getParameterGroupPage).mockResolvedValue({
            records: [
                {
                    id: 8,
                    code: 'daily_common',
                    name: '日常公共参数',
                    description: null,
                    version: 3,
                    revision: 4,
                    status: 'ACTIVE',
                    parameterCount: 1,
                    createdBy: 7,
                    updatedBy: 7,
                    createdAt: '2026-08-16T00:00:00Z',
                    updatedAt: '2026-08-16T00:00:00Z',
                },
                {
                    id: 9,
                    code: 'biz_core',
                    name: '业务核心参数',
                    description: null,
                    version: 1,
                    revision: 1,
                    status: 'ACTIVE',
                    parameterCount: 2,
                    createdBy: 7,
                    updatedBy: 7,
                    createdAt: '2026-08-16T00:00:00Z',
                    updatedAt: '2026-08-16T00:00:00Z',
                },
            ],
            total: 2,
            size: 100,
            current: 1,
            pages: 1,
        });

        vi.mocked(getParameterGroup).mockImplementation(async (_groupId, id) => {
            if (id === 8) {
                return {
                    id: 8,
                    code: 'daily_common',
                    name: '日常公共参数',
                    description: null,
                    version: 3,
                    revision: 4,
                    status: 'ACTIVE',
                    parameterCount: 1,
                    createdBy: 7,
                    updatedBy: 7,
                    createdAt: '2026-08-16T00:00:00Z',
                    updatedAt: '2026-08-16T00:00:00Z',
                    definitions: [{
                        id: 11,
                        key: 'v_day',
                        valueSource: 'SYSTEM_TIME',
                        constantValue: null,
                        timeBasis: 'PLANNED_TIME',
                        format: 'yyyyMMdd',
                        offsetDays: 0,
                        description: '通用日期',
                        sortOrder: 0,
                    }],
                };
            }
            return {
                id: 9,
                code: 'biz_core',
                name: '业务核心参数',
                description: null,
                version: 1,
                revision: 1,
                status: 'ACTIVE',
                parameterCount: 2,
                createdBy: 7,
                updatedBy: 7,
                createdAt: '2026-08-16T00:00:00Z',
                updatedAt: '2026-08-16T00:00:00Z',
                definitions: [
                    {
                        id: 21,
                        key: 'v_day',
                        valueSource: 'CONSTANT',
                        constantValue: '20260818',
                        timeBasis: 'PLANNED_TIME',
                        format: null,
                        offsetDays: 0,
                        description: '业务固定日期',
                        sortOrder: 0,
                    },
                    {
                        id: 22,
                        key: 'target_table',
                        valueSource: 'CONSTANT',
                        constantValue: 'orders',
                        timeBasis: 'PLANNED_TIME',
                        format: null,
                        offsetDays: 0,
                        description: '目标表',
                        sortOrder: 1,
                    },
                ],
            };
        });
    });

    afterEach(() => {
        cleanup();
        vi.clearAllMocks();
    });

    it('updates an outdated binding to the latest parameter group version', async () => {
        const onStage = vi.fn();
        render(
            <FlowParameterDialog
                open
                groupId={1}
                binding={outdatedBinding}
                onOpenChange={vi.fn()}
                onStage={onStage}
            />,
        );

        // Outdated badge and upgrade button
        const upgradeBtn = await screen.findByTitle('更新到最新版本');
        fireEvent.click(upgradeBtn);

        // Click stage button
        const stageBtn = await screen.findByRole('button', { name: '暂存绑定' });
        fireEvent.click(stageBtn);

        expect(onStage).toHaveBeenCalledWith(expect.objectContaining({
            parameterGroupId: 8,
            boundVersion: 3,
            status: 'CURRENT',
        }));
    });

    it('stages an explicit clear all / unbind', async () => {
        const onStage = vi.fn();
        render(
            <FlowParameterDialog
                open
                groupId={1}
                binding={outdatedBinding}
                onOpenChange={vi.fn()}
                onStage={onStage}
            />,
        );

        fireEvent.click(await screen.findByRole('button', { name: /清空所有绑定/ }));

        const stageBtn = screen.getByRole('button', { name: '暂存绑定' });
        fireEvent.click(stageBtn);

        expect(onStage).toHaveBeenCalledWith(null);
    });

    it('allows adding multiple parameter groups with priority ordering and overrides', async () => {
        const onStage = vi.fn();
        render(
            <FlowParameterDialog
                open
                groupId={1}
                binding={null}
                onOpenChange={vi.fn()}
                onStage={onStage}
            />,
        );

        // Wait for options to load
        await waitFor(() => {
            expect((screen.getByRole('combobox', { name: '参数组' }) as HTMLSelectElement).disabled).toBe(false);
        });

        // Add Group 1: 业务核心参数 (id 9)
        fireEvent.change(screen.getByRole('combobox', { name: '参数组' }), { target: { value: '9' } });

        await waitFor(() => {
            expect(screen.getByText('业务核心参数')).toBeTruthy();
        });

        // Add Group 2: 日常公共参数 (id 8)
        fireEvent.change(screen.getByRole('combobox', { name: '参数组' }), { target: { value: '8' } });

        await waitFor(() => {
            expect(screen.getByText('日常公共参数')).toBeTruthy();
        });

        // Priority #1 is 业务核心参数, Priority #2 is 日常公共参数
        expect(screen.getByText('#1')).toBeTruthy();
        expect(screen.getByText('#2')).toBeTruthy();
        expect(screen.getByText('可引用多个参数组。排在靠前的参数组具有更高的参数覆盖优先级。')).toBeTruthy();

        // The lower-priority duplicate is visibly marked as overridden.
        fireEvent.click(screen.getByText('日常公共参数'));
        expect(screen.getByText('已被上层覆盖')).toBeTruthy();

        // Stage binding
        const stageBtn = screen.getByRole('button', { name: '暂存绑定' });
        fireEvent.click(stageBtn);

        expect(onStage).toHaveBeenCalledWith(expect.objectContaining({
            parameterGroupId: 9,
            bindings: [
                expect.objectContaining({ parameterGroupId: 9, code: 'biz_core' }),
                expect.objectContaining({ parameterGroupId: 8, code: 'daily_common' }),
            ],
            definitions: expect.arrayContaining([
                expect.objectContaining({ key: 'v_day', valueSource: 'CONSTANT', constantValue: '20260818' }),
                expect.objectContaining({ key: 'target_table', constantValue: 'orders' }),
            ]),
        }));
    });

    it('supports reordering groups to adjust parameter override priority', async () => {
        const onStage = vi.fn();
        render(
            <FlowParameterDialog
                open
                groupId={1}
                binding={null}
                onOpenChange={vi.fn()}
                onStage={onStage}
            />,
        );

        await waitFor(() => {
            expect((screen.getByRole('combobox', { name: '参数组' }) as HTMLSelectElement).disabled).toBe(false);
        });

        // Add 业务核心参数 (id 9, v_day = CONSTANT 20260818)
        fireEvent.change(screen.getByRole('combobox', { name: '参数组' }), { target: { value: '9' } });
        await waitFor(() => expect(screen.getByText('业务核心参数')).toBeTruthy());

        // Add 日常公共参数 (id 8, v_day = SYSTEM_TIME)
        fireEvent.change(screen.getByRole('combobox', { name: '参数组' }), { target: { value: '8' } });
        await waitFor(() => expect(screen.getByText('日常公共参数')).toBeTruthy());

        // Move group 2 (日常公共参数) UP so it becomes #1 via drag & drop
        const cards = document.querySelectorAll('.flow-parameter-group-card');
        const dataTransfer = {
            effectAllowed: 'none',
            dropEffect: 'none',
            setData: vi.fn(),
            getData: vi.fn().mockReturnValue('1'),
        };
        fireEvent.dragStart(cards[1], { dataTransfer });
        fireEvent.dragOver(cards[0], { dataTransfer });
        fireEvent.drop(cards[0], { dataTransfer });
        fireEvent.dragEnd(cards[1]);

        // Now 日常公共参数 is #1
        const stageBtn = screen.getByRole('button', { name: '暂存绑定' });
        fireEvent.click(stageBtn);

        expect(onStage).toHaveBeenCalledWith(expect.objectContaining({
            parameterGroupId: 8,
            definitions: expect.arrayContaining([
                // Because daily_common is now #1, v_day is SYSTEM_TIME, not CONSTANT!
                expect.objectContaining({ key: 'v_day', valueSource: 'SYSTEM_TIME' }),
                expect.objectContaining({ key: 'target_table', constantValue: 'orders' }),
            ]),
        }));
    });

    it('supports removing a group', async () => {
        const onStage = vi.fn();
        render(
            <FlowParameterDialog
                open
                groupId={1}
                binding={outdatedBinding}
                onOpenChange={vi.fn()}
                onStage={onStage}
            />,
        );

        expect(await screen.findByText('日常公共参数')).toBeTruthy();
        fireEvent.click(screen.getByTitle('移除此参数组'));

        expect(document.querySelector('.flow-parameter-group-card')).toBeNull();
        expect(screen.getByText('尚未引入任何参数组。请在上方选择并添加参数组。')).toBeTruthy();
        const stageBtn = screen.getByRole('button', { name: '暂存绑定' });
        fireEvent.click(stageBtn);

        expect(onStage).toHaveBeenCalledWith(null);
    });

    it('supports drag and drop reordering with clean drag state reset', async () => {
        const onStage = vi.fn();
        render(
            <FlowParameterDialog
                open
                groupId={1}
                binding={null}
                onOpenChange={vi.fn()}
                onStage={onStage}
            />,
        );

        await waitFor(() => {
            expect((screen.getByRole('combobox', { name: '参数组' }) as HTMLSelectElement).disabled).toBe(false);
        });

        // Add 业务核心参数 (id 9) and 日常公共参数 (id 8)
        fireEvent.change(screen.getByRole('combobox', { name: '参数组' }), { target: { value: '9' } });
        await waitFor(() => expect(screen.getByText('业务核心参数')).toBeTruthy());
        fireEvent.change(screen.getByRole('combobox', { name: '参数组' }), { target: { value: '8' } });
        await waitFor(() => expect(screen.getByText('日常公共参数')).toBeTruthy());

        const cards = document.querySelectorAll('.flow-parameter-group-card');
        expect(cards.length).toBe(2);

        // Drag card 0 to card 1
        const dataTransfer = {
            effectAllowed: 'none',
            dropEffect: 'none',
            setData: vi.fn(),
            getData: vi.fn().mockReturnValue('0'),
        };

        fireEvent.dragStart(cards[0], { dataTransfer });
        expect(cards[0].classList.contains('is-dragging')).toBe(true);

        fireEvent.dragOver(cards[1], { dataTransfer });
        fireEvent.drop(cards[1], { dataTransfer });
        fireEvent.dragEnd(cards[0]);

        // After drag drop, is-dragging should be cleaned up
        expect(cards[0].classList.contains('is-dragging')).toBe(false);

        // Stage binding and verify daily_common (id 8) became primary #1
        const stageBtn = screen.getByRole('button', { name: '暂存绑定' });
        fireEvent.click(stageBtn);

        expect(onStage).toHaveBeenCalledWith(expect.objectContaining({
            parameterGroupId: 8,
        }));
    });
});
