import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { OfflineFlowNode } from '../../../api/offline';
import type { NodeVersionDiff } from './flowVersionDiff';
import { OfflineNodeDiffDialog } from './OfflineNodeDiffDialog';

vi.mock('@pierre/diffs/react', () => ({
    FileDiff: ({ fileDiff, options }: { fileDiff: { name: string; type: string }; options?: Record<string, unknown> }) => (
        <div
            data-testid="pierre-file-diff"
            data-file-name={fileDiff.name}
            data-change-type={fileDiff.type}
            data-diff-style={String(options?.diffStyle ?? '')}
            data-expand-unchanged={String(options?.expandUnchanged ?? false)}
            data-overflow={String(options?.overflow ?? '')}
        />
    ),
    File: ({ file, options }: { file: { name: string }; options?: Record<string, unknown> }) => (
        <div
            data-testid="pierre-file-preview"
            data-file-name={file.name}
            data-overflow={String(options?.overflow ?? '')}
        />
    ),
}));

function transferNode(writeMode: 'append' | 'overwrite_table', amount: string): OfflineFlowNode {
    return {
        taskId: 'transfer_orders',
        kind: 'TRANSFER',
        transfer: {
            source: { dataSourceId: 1, dataSourceType: 'MYSQL', database: 'crm', table: 'orders' },
            target: { dataSourceId: 2, dataSourceType: 'CLICKHOUSE', database: 'dm', table: 'sales', writeMode },
            fieldMappings: [{ target: 'amount', kind: 'source_expression', expression: `quantity * ${amount}` }],
            partitions: [],
        },
    };
}

describe('OfflineNodeDiffDialog', () => {
    afterEach(cleanup);
    it('renders transfer endpoints and field mappings structurally', () => {
        render(
            <OfflineNodeDiffDialog
                node={{
                    taskId: 'transfer_orders',
                    kind: 'MODIFIED',
                    contentChanged: true,
                    configChanged: false,
                    structureChanged: false,
                    upstreamChanged: false,
                    referencedParametersAdded: [],
                    referencedParametersRemoved: [],
                    baseNode: transferNode('append', 'price'),
                    targetNode: transferNode('overwrite_table', 'cost'),
                }}
                open
                onOpenChange={vi.fn()}
            />,
        );

        expect(screen.getByText('源端')).toBeTruthy();
        expect(screen.getByText('目标端')).toBeTruthy();
        expect(screen.getByText('字段映射')).toBeTruthy();
        expect(screen.getByText('source_expression: quantity * price')).toBeTruthy();
        expect(screen.getByText('source_expression: quantity * cost')).toBeTruthy();
        expect(screen.getByText('append')).toBeTruthy();
        expect(screen.getByText('overwrite_table')).toBeTruthy();
    });

    it('does not highlight equal preSql arrays and supports stepping between changed nodes', () => {
        const transferDiff: NodeVersionDiff = {
            taskId: 'transfer_orders',
            kind: 'MODIFIED',
            contentChanged: true,
            configChanged: false,
            structureChanged: false,
            upstreamChanged: false,
            referencedParametersAdded: [],
            referencedParametersRemoved: [],
            baseNode: {
                taskId: 'transfer_orders',
                kind: 'TRANSFER',
                transfer: {
                    source: { dataSourceId: 1, dataSourceType: 'MYSQL', database: 'crm', table: 'orders', preSql: ['SELECT 1'] },
                    target: { dataSourceId: 2, dataSourceType: 'CLICKHOUSE', database: 'dm', table: 'sales', writeMode: 'append' },
                    fieldMappings: [{ target: 'id', kind: 'source_field', source: 'id' }],
                    partitions: [],
                },
            },
            targetNode: {
                taskId: 'transfer_orders',
                kind: 'TRANSFER',
                transfer: {
                    source: { dataSourceId: 1, dataSourceType: 'MYSQL', database: 'crm', table: 'orders', preSql: ['SELECT 1'] },
                    target: { dataSourceId: 2, dataSourceType: 'CLICKHOUSE', database: 'dm', table: 'sales', writeMode: 'append' },
                    fieldMappings: [{ target: 'id', kind: 'source_field', source: 'id' }],
                    partitions: [],
                },
            },
        };
        const sqlDiff: NodeVersionDiff = {
            taskId: 'agg_sql',
            kind: 'MODIFIED',
            contentChanged: true,
            configChanged: false,
            structureChanged: false,
            upstreamChanged: false,
            referencedParametersAdded: [],
            referencedParametersRemoved: [],
            baseNode: { taskId: 'agg_sql', kind: 'SQL', scriptContent: 'select 1;', dataSourceId: 1, dataSourceType: 'MYSQL' },
            targetNode: { taskId: 'agg_sql', kind: 'SQL', scriptContent: 'select 2;', dataSourceId: 1, dataSourceType: 'MYSQL' },
        };
        const onSelectNode = vi.fn();

        render(
            <OfflineNodeDiffDialog
                open
                nodeDiff={transferDiff}
                changedNodes={[transferDiff, sqlDiff]}
                dataSourceNames={{ 1: 'crm_mysql', 2: 'analytics_ck' }}
                onSelectNode={onSelectNode}
                onClose={vi.fn()}
            />,
        );

        expect(screen.getAllByText(/crm_mysql/).length).toBeGreaterThan(0);
        const preSqlRow = Array.from(document.querySelectorAll('.offline-transfer-row'))
            .find((row) => row.textContent?.includes('前置 SQL'));
        expect(preSqlRow).toBeTruthy();
        expect(preSqlRow?.classList.contains('is-modified')).toBe(false);

        fireEvent.click(screen.getByRole('button', { name: '下一个' }));
        expect(onSelectNode).toHaveBeenCalledWith(sqlDiff);
    });

    it('renders SQL diff stats via Pierre diffs and handles mode toggles and whitespace-only edits', () => {
        const whitespaceDiff: NodeVersionDiff = {
            taskId: 'agg_sql',
            kind: 'MODIFIED',
            contentChanged: false,
            configChanged: false,
            structureChanged: false,
            upstreamChanged: true,
            referencedParametersAdded: [],
            referencedParametersRemoved: [],
            baseNode: {
                taskId: 'agg_sql',
                kind: 'HIVE_SQL',
                scriptPath: 'scripts/agg_sql.sql',
                scriptContent: 'SELECT a, b\nFROM orders\n',
            },
            targetNode: {
                taskId: 'agg_sql',
                kind: 'HIVE_SQL',
                scriptPath: 'scripts/agg_sql.sql',
                scriptContent: '  SELECT a, b  \n    FROM orders\n',
            },
        };

        render(
            <OfflineNodeDiffDialog
                open
                nodeDiff={whitespaceDiff}
                onClose={vi.fn()}
            />,
        );

        expect(screen.getAllByText('scripts/agg_sql.sql').length).toBeGreaterThan(0);
        expect(screen.getByText('仅存在首尾空白或缩进变化')).toBeTruthy();
        expect(screen.getByTestId('pierre-file-preview')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: '显示空白差异' }));
        expect(screen.getByText('+2')).toBeTruthy();
        expect(screen.getByText('-2')).toBeTruthy();
        const diffEl = screen.getByTestId('pierre-file-diff');
        expect(diffEl.getAttribute('data-file-name')).toBe('scripts/agg_sql.sql');
        expect(diffEl.getAttribute('data-diff-style')).toBe('split');
        expect(diffEl.getAttribute('data-expand-unchanged')).toBe('false');
        expect(diffEl.getAttribute('data-overflow')).toBe('wrap');

        fireEvent.click(screen.getByRole('button', { name: '内联' }));
        expect(screen.getByTestId('pierre-file-diff').getAttribute('data-diff-style')).toBe('unified');

        fireEvent.click(screen.getByRole('button', { name: '展开全文' }));
        expect(screen.getByTestId('pierre-file-diff').getAttribute('data-expand-unchanged')).toBe('true');

        fireEvent.click(screen.getByRole('button', { name: '自动换行' }));
        expect(screen.getByTestId('pierre-file-diff').getAttribute('data-overflow')).toBe('scroll');
    });

    it('renders added and identical scripts gracefully without crashing', () => {
        const addedNode: NodeVersionDiff = {
            taskId: 'new_shell',
            kind: 'ADDED',
            contentChanged: true,
            configChanged: false,
            structureChanged: false,
            upstreamChanged: false,
            referencedParametersAdded: [],
            referencedParametersRemoved: [],
            baseNode: null,
            targetNode: {
                taskId: 'new_shell',
                kind: 'SHELL',
                scriptContent: '#!/usr/bin/env bash\necho ok\n',
            },
        };

        const { rerender } = render(<OfflineNodeDiffDialog open nodeDiff={addedNode} onClose={vi.fn()} />);
        expect(screen.getByTestId('pierre-file-diff').getAttribute('data-change-type')).toBe('new');
        expect(screen.getByTestId('pierre-file-diff').getAttribute('data-file-name')).toBe('new_shell.sh');
        expect(screen.getByText('+2')).toBeTruthy();

        const identicalNode: NodeVersionDiff = {
            ...addedNode,
            kind: 'MODIFIED',
            contentChanged: false,
            upstreamChanged: true,
            baseNode: addedNode.targetNode,
        };
        rerender(<OfflineNodeDiffDialog open nodeDiff={identicalNode} onClose={vi.fn()} />);
        expect(screen.getByText(/脚本内容与基准版本一致/)).toBeTruthy();
        expect(screen.getByTestId('pierre-file-preview')).toBeTruthy();
    });

    it('renders structured Hive runtime parameter diff rows for HIVE_SQL nodes', () => {
        const hiveDiff: NodeVersionDiff = {
            taskId: 'hive_node_1',
            kind: 'MODIFIED',
            contentChanged: false,
            configChanged: false,
            hiveConfChanged: true,
            structureChanged: false,
            upstreamChanged: false,
            referencedParametersAdded: [],
            referencedParametersRemoved: [],
            baseNode: {
                taskId: 'hive_node_1',
                kind: 'HIVE_SQL',
                scriptContent: 'SELECT 1;',
                dataSourceId: 2,
                dataSourceType: 'HIVE',
                hiveConf: {
                    'hive.exec.dynamic.partition': 'true',
                    'mapreduce.job.queuename': 'dev',
                },
            },
            targetNode: {
                taskId: 'hive_node_1',
                kind: 'HIVE_SQL',
                scriptContent: 'SELECT 1;',
                dataSourceId: 2,
                dataSourceType: 'HIVE',
                hiveConf: {
                    'hive.exec.dynamic.partition': 'true',
                    'hive.exec.dynamic.partition.mode': 'nonstrict',
                },
            },
        };

        render(<OfflineNodeDiffDialog open nodeDiff={hiveDiff} onClose={vi.fn()} />);
        expect(screen.getAllByText('Hive 运行参数').length).toBeGreaterThanOrEqual(2);
        expect(screen.getByText('2 项变更')).toBeTruthy();
        expect(screen.getByText('hive.exec.dynamic.partition.mode')).toBeTruthy();
        expect(screen.getByText('nonstrict')).toBeTruthy();
        expect(screen.getByText('mapreduce.job.queuename')).toBeTruthy();
    });
});
