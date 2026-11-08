import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { OfflineFlowNode } from '../../api/offline';
import { OfflineNodeDiffDialog } from './OfflineNodeDiffDialog';

vi.mock('@monaco-editor/react', () => ({ DiffEditor: () => <div data-testid="diff-editor" /> }));

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
});
