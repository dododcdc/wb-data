import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DataSource } from '../../../api/datasource';
import type { TransferTableMetadataResponse } from '../../../api/transfer';
import { TransferNodeDialog } from './TransferNodeDialog';
import type { TransferAsyncResource, TransferPagedResource } from './useTransferMetadata';
import type { TransferConfig, TransferEndpointConfig } from './transferTypes';

interface EndpointMetadata {
    databases: TransferAsyncResource<string[]>;
    tables: TransferPagedResource<string>;
    metadata: TransferAsyncResource<TransferTableMetadataResponse | null>;
}

interface MockTransferMetadata {
    dataSources: DataSource[];
    dataSourceSearch: TransferPagedResource<DataSource>;
    source: EndpointMetadata;
    target: EndpointMetadata;
}

const sourceMetadata: TransferTableMetadataResponse = {
    columns: [{ name: 'id', type: 'BIGINT', size: 0, nullable: false, remarks: '来源订单编号', primaryKey: true }],
    partitionColumns: [],
    partitioned: false,
    writeModes: [{ value: 'append', label: 'Append' }],
};

const targetMetadata: TransferTableMetadataResponse = {
    columns: [{ name: 'id', type: 'BIGINT', size: 0, nullable: false, remarks: '目标订单编号', primaryKey: false }],
    partitionColumns: [{ name: 'dayno', type: 'STRING', remarks: '' }],
    partitioned: true,
    writeModes: [
        { value: 'append', label: 'Append' },
        { value: 'overwrite_partition', label: 'Overwrite partition' },
    ],
};

const dataSources: DataSource[] = [
    {
        id: 1,
        name: 'mysql_source',
        type: 'MYSQL',
        description: '',
        databaseName: 'transfer_demo',
        connectionParams: {},
        status: 'ENABLED',
        owner: 'admin',
        createdAt: '',
        updatedAt: '',
    },
    {
        id: 2,
        name: 'hive_target',
        type: 'HIVE',
        description: '',
        databaseName: 'default',
        connectionParams: {},
        status: 'ENABLED',
        owner: 'admin',
        createdAt: '',
        updatedAt: '',
    },
    {
        id: 3,
        name: 'postgres_archive',
        type: 'POSTGRESQL',
        description: '',
        databaseName: 'archive',
        connectionParams: {},
        status: 'ENABLED',
        owner: 'admin',
        createdAt: '',
        updatedAt: '',
    },
    {
        id: 4,
        name: 'clickhouse_target',
        type: 'CLICKHOUSE',
        description: '',
        databaseName: 'analytics',
        connectionParams: {},
        status: 'ENABLED',
        owner: 'admin',
        createdAt: '',
        updatedAt: '',
    },
];

function resource<T>(data: T, overrides: Partial<TransferAsyncResource<T>> = {}): TransferAsyncResource<T> {
    return { data, loading: false, error: null, retry: vi.fn(), ...overrides };
}

function pagedResource<T>(data: T[], overrides: Partial<TransferPagedResource<T>> = {}): TransferPagedResource<T> {
    return {
        data,
        loading: false,
        loadingMore: false,
        hasMore: false,
        error: null,
        retry: vi.fn(),
        search: vi.fn(),
        loadMore: vi.fn(),
        ...overrides,
    };
}

function makeMetadata(): MockTransferMetadata {
    return {
        dataSources,
        dataSourceSearch: pagedResource(dataSources),
        source: {
            databases: resource(['transfer_demo', 'archive', 'analytics']),
            tables: pagedResource(['orders']),
            metadata: resource(sourceMetadata),
        },
        target: {
            databases: resource(['default']),
            tables: pagedResource(['dwd_orders', 'dwd_payments', 'dwd_customers']),
            metadata: resource(targetMetadata),
        },
    };
}

let metadata = makeMetadata();
let resolveMetadata: ((args: unknown[]) => MockTransferMetadata) | null = null;

vi.mock('./useTransferMetadata', () => ({
    useTransferMetadata: (...args: unknown[]) => resolveMetadata?.(args) ?? metadata,
}));

const validTransfer: TransferConfig = {
    source: {
        dataSourceId: 1,
        dataSourceType: 'MYSQL',
        database: 'transfer_demo',
        table: 'orders',
        where: "status = 'ACTIVE'",
    },
    target: {
        dataSourceId: 2,
        dataSourceType: 'HIVE',
        database: 'default',
        table: 'dwd_orders',
        writeMode: 'append',
    },
    fieldMappings: [{ target: 'id', kind: 'source_field', source: 'id' }],
    partitions: [{ target: 'dayno', kind: 'static_value', value: '20260719' }],
};

function makeSqlTransfer(target: Partial<TransferEndpointConfig> = {}): TransferConfig {
    metadata = {
        ...metadata,
        source: { ...metadata.source, tables: pagedResource(['orders', 'payments']) },
        target: {
            ...metadata.target,
            databases: resource(['transfer_demo', 'archive', 'analytics', 'default']),
            metadata: resource({ ...sourceMetadata, columns: targetMetadata.columns }),
        },
    };
    return {
        ...validTransfer,
        target: {
            dataSourceId: 1,
            dataSourceType: 'MYSQL',
            database: 'transfer_demo',
            table: 'orders_target',
            writeMode: 'append',
            ...target,
        },
        partitions: [],
    };
}

async function selectEndpointOption(label: string, side: 'source' | 'target', option: string) {
    const selector = screen.getAllByLabelText(label)[side === 'source' ? 0 : 1];
    fireEvent.click(selector.parentElement?.querySelector('[data-slot="combobox-trigger"]') as HTMLElement);
    fireEvent.click(await screen.findByRole('option', { name: option }));
}

afterEach(() => {
    cleanup();
    metadata = makeMetadata();
    resolveMetadata = null;
});

describe('TransferNodeDialog', () => {
    describe('target SQL', () => {
        it.each(['MYSQL', 'POSTGRESQL', 'CLICKHOUSE', 'HIVE'] as const)(
            'shows compact SQL controls only on supported targets: %s',
            (dataSourceType) => {
                const dataSource = dataSources.find((item) => item.type === dataSourceType)!;
                const value = makeSqlTransfer({
                    dataSourceId: dataSource.id,
                    dataSourceType,
                    database: dataSource.databaseName,
                });
                const onChange = vi.fn();
                render(<TransferNodeDialog groupId={1} value={value} onChange={onChange} />);

                const sourcePanel = screen.getByRole('heading', { name: '来源' }).closest('section')!;
                const targetPanel = screen.getByRole('heading', { name: '目标' }).closest('section')!;
                expect(within(sourcePanel).queryByRole('button', { name: /前置 SQL|后置 SQL/ })).toBeNull();
                for (const label of ['前置 SQL', '后置 SQL']) {
                    const toggle = within(targetPanel).queryByRole('button', { name: `${label} 0/5` });
                    if (dataSourceType === 'HIVE') {
                        expect(toggle).toBeNull();
                    } else {
                        expect(toggle?.getAttribute('aria-expanded')).toBe('false');
                        expect(document.getElementById(toggle!.getAttribute('aria-controls')!)).toHaveProperty('hidden', true);
                        expect(within(targetPanel).queryByRole('button', { name: `添加${label}` })).toBeNull();
                    }
                }
                expect(within(targetPanel).queryByRole('textbox')).toBeNull();
                expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ target: value.target }));
            },
        );

        describe.each([['preSql', '前置 SQL'], ['postSql', '后置 SQL']] as const)('%s', (key, label) => {
            it('saves and restores value placeholders verbatim without changing target identifiers', () => {
                const value = makeSqlTransfer({ preSql: ['SELECT 1'], postSql: ['SELECT 2'] });
                const onChange = vi.fn();
                const { unmount } = render(<TransferNodeDialog groupId={1} value={value} onChange={onChange} />);
                fireEvent.click(screen.getByRole('button', { name: `${label} 1/5` }));
                onChange.mockClear();

                const sql = '  DELETE FROM orders_target\nWHERE dayno = ^[v_day];  ';
                const editor = screen.getByRole('textbox', { name: `${label} 第 1 条` });
                fireEvent.change(editor, { target: { value: sql } });

                expect(editor).toHaveProperty('value', sql);
                expect(onChange).toHaveBeenLastCalledWith({
                    ...value,
                    target: { ...value.target, [key]: [sql] },
                });
                const persisted: TransferConfig = JSON.parse(JSON.stringify(onChange.mock.lastCall?.[0]));
                unmount();
                render(<TransferNodeDialog groupId={1} value={persisted} onChange={vi.fn()} />);
                fireEvent.click(screen.getByRole('button', { name: `${label} 1/5` }));
                expect(screen.getByRole('textbox', { name: `${label} 第 1 条` })).toHaveProperty('value', sql);
            });

            it('adds up to five editors with focus, deletes and renumbers them', () => {
                const onChange = vi.fn();
                const onDraftChange = vi.fn();
                render(<TransferNodeDialog groupId={1} value={makeSqlTransfer()} onChange={onChange} onDraftChange={onDraftChange} />);
                const toggle = screen.getByRole('button', { name: `${label} 0/5` });
                fireEvent.click(toggle);
                const addButton = screen.getByRole('button', { name: `添加${label}` });
                const statements: string[] = [];
                for (let index = 0; index < 5; index += 1) {
                    onChange.mockClear();
                    fireEvent.click(addButton);
                    const input = screen.getByRole('textbox', { name: `${label} 第 ${index + 1} 条` });
                    expect(document.activeElement).toBe(input);
                    expect(input.getAttribute('aria-invalid')).toBe('true');
                    expect(onChange).not.toHaveBeenCalled();
                    expect(onDraftChange).toHaveBeenLastCalledWith(expect.any(Object), expect.objectContaining({ valid: false }));
                    statements.push(`UPDATE orders_target\nSET id = ${index + 1};`);
                    fireEvent.change(input, { target: { value: statements[index] } });
                    expect(input.getAttribute('aria-invalid')).toBe('false');
                }
                expect(toggle.textContent).toContain('5/5');
                expect(addButton).toHaveProperty('disabled', true);
                fireEvent.click(addButton);
                expect(screen.getAllByRole('textbox', { name: new RegExp(`${label} 第`) })).toHaveLength(5);
                expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
                    target: expect.objectContaining({ [key]: statements }),
                }));

                fireEvent.click(screen.getByRole('button', { name: `删除${label}第 2 条` }));
                expect(screen.getByRole('textbox', { name: `${label} 第 2 条` })).toHaveProperty('value', statements[2]);
                expect(addButton).toHaveProperty('disabled', false);
                expect(toggle.textContent).toContain('4/5');
                expect(onDraftChange).toHaveBeenLastCalledWith(expect.objectContaining({
                    target: expect.objectContaining({ [key]: statements.filter((_, index) => index !== 1) }),
                }), expect.objectContaining({ valid: true }));

                for (let index = 0; index < 4; index += 1) {
                    fireEvent.click(screen.getByRole('button', { name: `删除${label}第 1 条` }));
                }
                expect(toggle.textContent).toContain('0/5');
                expect(screen.queryByRole('textbox', { name: new RegExp(`${label} 第`) })).toBeNull();
                expect(document.activeElement).toBe(addButton);
                expect(onDraftChange).toHaveBeenLastCalledWith(expect.objectContaining({
                    target: expect.objectContaining({ [key]: [] }),
                }), expect.objectContaining({ valid: true }));
            });

            it.each([5, 6])('shows all %i saved statements and blocks over-limit output until corrected', (count) => {
                const statements = Array.from({ length: count }, (_, index) => `SELECT ${index + 1};`);
                const onChange = vi.fn();
                const onDraftChange = vi.fn();
                render(<TransferNodeDialog groupId={1} value={makeSqlTransfer({ [key]: statements })} onChange={onChange} onDraftChange={onDraftChange} />);
                const toggle = screen.getByRole('button', { name: new RegExp(`^${label} ${count}/5`) });
                expect(onDraftChange).toHaveBeenLastCalledWith(expect.objectContaining({
                    target: expect.objectContaining({ [key]: statements }),
                }), expect.objectContaining({ valid: count <= 5 }));
                if (count === 6) expect(onChange).not.toHaveBeenCalled();
                fireEvent.click(toggle);
                expect(screen.getAllByRole('textbox', { name: new RegExp(`${label} 第`) })).toHaveLength(count);
                expect(screen.getByRole('button', { name: `添加${label}` })).toHaveProperty('disabled', true);
                if (count === 6) {
                    expect(toggle.textContent).toContain('超出上限');
                    fireEvent.click(screen.getByRole('button', { name: `删除${label}第 6 条` }));
                }
                expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
                    target: expect.objectContaining({ [key]: statements.slice(0, 5) }),
                }));
            });

            it.each(['', ' \n\t '])('preserves an invalid saved empty item and blocks valid output: %j', (sql) => {
                const onChange = vi.fn();
                const onDraftChange = vi.fn();
                render(<TransferNodeDialog groupId={1} value={makeSqlTransfer({ [key]: [sql] })} onChange={onChange} onDraftChange={onDraftChange} />);

                const toggle = screen.getByRole('button', { name: new RegExp(`^${label} 1/5`) });
                expect(toggle.textContent).toContain('有空项');
                expect(onChange).not.toHaveBeenCalled();
                expect(onDraftChange).toHaveBeenLastCalledWith(expect.objectContaining({
                    target: expect.objectContaining({ [key]: [sql] }),
                }), expect.objectContaining({ valid: false, errors: [`目标${label}第 1 条不能为空`] }));
                fireEvent.click(toggle);
                const input = screen.getByRole('textbox', { name: `${label} 第 1 条` });
                expect(input).toHaveProperty('value', sql);
                expect(input.getAttribute('aria-invalid')).toBe('true');
                expect(screen.getByText('请输入 SQL 或删除此项')).toBeTruthy();
                fireEvent.change(input, { target: { value: 'SELECT 1' } });
                expect(onChange).toHaveBeenCalled();
            });
        });

        it('echoes drafts and restores multiline SQL verbatim without remounting an IME editor', () => {
            const preSql = ["  UPDATE orders_target\nSET status = '就绪';  "];
            const postSql = ['  ANALYZE orders_target;\n'];
            const initial = { ...makeSqlTransfer({ preSql, postSql }), fieldMappings: [] };
            const onDraftChange = vi.fn();
            const onChange = vi.fn();
            let saved = initial as TransferConfig;
            function EchoingParent() {
                const [value, setValue] = useState<TransferConfig>(initial);
                return <TransferNodeDialog groupId={1} value={value} onChange={onChange} onDraftChange={(draft, state) => {
                    onDraftChange(draft, state);
                    saved = draft;
                    setValue(draft);
                }} />;
            }
            const { unmount } = render(<EchoingParent />);
            expect(onDraftChange).toHaveBeenLastCalledWith(expect.objectContaining({
                target: expect.objectContaining({ preSql, postSql }),
                fieldMappings: [{ target: 'id', kind: 'source_field', source: 'id' }],
            }), expect.objectContaining({ valid: true }));
            fireEvent.click(screen.getByRole('button', { name: '前置 SQL 1/5' }));
            fireEvent.click(screen.getByRole('button', { name: '后置 SQL 1/5' }));
            expect(screen.getByText(/每项仅填写一条 SQL，可换行；按编号顺序执行/)).toBeTruthy();
            expect(screen.getByText(/更换目标数据源、数据库或表会清空前后 SQL/)).toBeTruthy();
            expect(screen.getByText('支持参数组 ^[参数名] 值占位符，不要加引号；不支持动态数据库、表或字段名。', { exact: false })).toBeTruthy();
            expect(screen.getByText('传输前执行，前置 SQL 失败则不进行传输。')).toBeTruthy();
            expect(screen.getByText('仅传输成功后执行。后置 SQL 失败会使节点失败，但不回滚已写入数据，请自行处理。')).toBeTruthy();
            const editor = screen.getByRole('textbox', { name: '前置 SQL 第 1 条' });
            expect(editor).toHaveProperty('value', preSql[0]);
            expect(screen.getByRole('textbox', { name: '后置 SQL 第 1 条' })).toHaveProperty('value', postSql[0]);
            editor.focus();
            fireEvent.compositionStart(editor);
            for (const text of ['zhong', '中', '中文']) {
                const sql = `  UPDATE orders_target\nSET status = '${text}'\nWHERE id = 1;  `;
                fireEvent.change(editor, { target: { value: sql } });
                expect(screen.getByRole('textbox', { name: '前置 SQL 第 1 条' })).toBe(editor);
                expect(document.activeElement).toBe(editor);
                expect(editor).toHaveProperty('value', sql);
                expect(onDraftChange).toHaveBeenLastCalledWith(expect.objectContaining({
                    target: expect.objectContaining({ preSql: [sql], postSql }),
                }), expect.objectContaining({ valid: true }));
            }
            fireEvent.compositionEnd(editor, { data: '中文' });
            fireEvent.keyDown(editor, { key: 'Enter' });
            expect(document.activeElement).toBe(editor);
            const editedPostSql = '  UPDATE orders_target\nSET id = 2;\n';
            fireEvent.change(screen.getByRole('textbox', { name: '后置 SQL 第 1 条' }), { target: { value: editedPostSql } });
            expect(saved.target.postSql).toEqual([editedPostSql]);
            expect(onChange).toHaveBeenLastCalledWith(saved);
            const persisted: TransferConfig = JSON.parse(JSON.stringify(saved));
            unmount();
            render(<TransferNodeDialog groupId={1} value={persisted} onChange={vi.fn()} />);
            fireEvent.click(screen.getByRole('button', { name: '前置 SQL 1/5' }));
            fireEvent.click(screen.getByRole('button', { name: '后置 SQL 1/5' }));
            expect(screen.getByRole('textbox', { name: '前置 SQL 第 1 条' })).toHaveProperty('value', persisted.target.preSql?.[0]);
            expect(screen.getByRole('textbox', { name: '后置 SQL 第 1 条' })).toHaveProperty('value', editedPostSql);
        });

        describe.each(['source', 'target'] as const)('changing %s', (side) => {
            it.each([
                ['数据源', 'postgres_archive (POSTGRESQL)'],
                ['数据库', 'analytics'],
                ['表', 'dwd_payments'],
            ])('%s clears SQL only when target identity changes', async (label, option) => {
                const sql = { preSql: [' DELETE FROM staging;\n'], postSql: [' ANALYZE orders_target;\n'] };
                const value = makeSqlTransfer(sql);
                const onDraftChange = vi.fn();
                render(<TransferNodeDialog groupId={1} value={value} onChange={vi.fn()} onDraftChange={onDraftChange} />);
                await selectEndpointOption(label, side, label === '表' && side === 'source' ? 'payments' : option);

                expect(onDraftChange).toHaveBeenLastCalledWith(expect.objectContaining({
                    target: expect.objectContaining(side === 'source' ? sql : { preSql: undefined, postSql: undefined }),
                }), expect.any(Object));
            });
        });

        it.each([
            ['数据源', 'mysql_source (MYSQL)'],
            ['数据库', 'transfer_demo'],
            ['表', 'orders_target'],
        ])('preserves SQL when reselecting the same target %s', async (label, option) => {
            const value = makeSqlTransfer({ preSql: ['SELECT 1'], postSql: ['SELECT 2'] });
            const onDraftChange = vi.fn();
            render(<TransferNodeDialog groupId={1} value={value} onChange={vi.fn()} onDraftChange={onDraftChange} />);
            const callCount = onDraftChange.mock.calls.length;
            await selectEndpointOption(label, 'target', option);

            expect(onDraftChange).toHaveBeenCalledTimes(callCount);
            expect(onDraftChange).toHaveBeenLastCalledWith(value, expect.objectContaining({ valid: true }));
        });

        it('preserves SQL through metadata refresh and reconciliation', () => {
            const sql = { preSql: ['  SELECT 1;\n'], postSql: ['  SELECT 2;\n'] };
            const value = makeSqlTransfer(sql);
            const onDraftChange = vi.fn();
            const onChange = vi.fn();
            const { rerender } = render(<TransferNodeDialog groupId={1} value={value} onChange={onChange} onDraftChange={onDraftChange} />);
            fireEvent.click(screen.getByRole('button', { name: '刷新字段结构' }));
            expect(metadata.source.metadata.retry).toHaveBeenCalledOnce();
            expect(metadata.target.metadata.retry).toHaveBeenCalledOnce();
            const readyMetadata = metadata;
            metadata = {
                ...metadata,
                source: { ...metadata.source, metadata: resource(null, { loading: true }) },
                target: { ...metadata.target, metadata: resource(null, { loading: true }) },
            };
            rerender(<TransferNodeDialog groupId={1} value={value} onChange={onChange} onDraftChange={onDraftChange} />);
            metadata = readyMetadata;
            rerender(<TransferNodeDialog groupId={1} value={value} onChange={onChange} onDraftChange={onDraftChange} />);

            expect(onDraftChange.mock.calls.length).toBeGreaterThan(1);
            for (const [draft] of onDraftChange.mock.calls) expect(draft.target).toMatchObject(sql);
            expect(onDraftChange).toHaveBeenLastCalledWith(expect.objectContaining({
                target: expect.objectContaining(sql),
            }), expect.objectContaining({ valid: true }));
        });
    });

    it('filters datasource, database, and table options from searchable selectors', async () => {
        render(<TransferNodeDialog groupId={1} value={validTransfer} onChange={vi.fn()} />);

        const sourceDataSource = screen.getAllByLabelText('数据源')[0];
        fireEvent.click(sourceDataSource.parentElement?.querySelector('[data-slot="combobox-trigger"]') as HTMLElement);
        expect(sourceDataSource).toHaveProperty('value', '');
        expect(screen.queryByRole('searchbox')).toBeNull();
        fireEvent.change(sourceDataSource, { target: { value: 'hive_target' } });
        expect(await screen.findByRole('option', { name: 'hive_target (HIVE)' })).toBeTruthy();
        expect(metadata.dataSourceSearch.search).toHaveBeenLastCalledWith('hive_target');
        await waitFor(() => {
            expect(screen.queryByRole('option', { name: 'postgres_archive (POSTGRESQL)' })).toBeNull();
        });

        fireEvent.keyDown(sourceDataSource, { key: 'Escape' });
        const sourceDatabase = screen.getAllByLabelText('数据库')[0];
        fireEvent.click(sourceDatabase.parentElement?.querySelector('[data-slot="combobox-trigger"]') as HTMLElement);
        expect(sourceDatabase).toHaveProperty('value', '');
        fireEvent.change(sourceDatabase, { target: { value: 'arch' } });
        expect(await screen.findByRole('option', { name: 'archive' })).toBeTruthy();
        await waitFor(() => {
            expect(screen.queryByRole('option', { name: 'analytics' })).toBeNull();
        });

        fireEvent.keyDown(sourceDatabase, { key: 'Escape' });
        const targetTable = screen.getAllByLabelText('表')[1];
        fireEvent.click(targetTable.parentElement?.querySelector('[data-slot="combobox-trigger"]') as HTMLElement);
        expect(targetTable).toHaveProperty('value', '');
        fireEvent.change(targetTable, { target: { value: 'payments' } });
        expect(await screen.findByRole('option', { name: 'dwd_payments' })).toBeTruthy();
        await waitFor(() => {
            expect(screen.queryByRole('option', { name: 'dwd_customers' })).toBeNull();
        });
    });

    it('uses field-specific minimum widths for endpoint menus', async () => {
        render(<TransferNodeDialog groupId={1} value={validTransfer} onChange={vi.fn()} />);

        const sourceDataSource = screen.getAllByLabelText('数据源')[0];
        fireEvent.click(sourceDataSource.parentElement?.querySelector('[data-slot="combobox-trigger"]') as HTMLElement);
        let popup = (await screen.findByRole('option', { name: 'mysql_source (MYSQL)' }))
            .closest('[data-slot="combobox-content"]');
        expect(popup?.className).toContain('min-w-[280px]');

        fireEvent.keyDown(sourceDataSource, { key: 'Escape' });
        const sourceDatabase = screen.getAllByLabelText('数据库')[0];
        fireEvent.click(sourceDatabase.parentElement?.querySelector('[data-slot="combobox-trigger"]') as HTMLElement);
        popup = (await screen.findByRole('option', { name: 'transfer_demo' }))
            .closest('[data-slot="combobox-content"]');
        expect(popup?.className).toContain('min-w-[180px]');

        fireEvent.keyDown(sourceDatabase, { key: 'Escape' });
        const targetTable = screen.getAllByLabelText('表')[1];
        fireEvent.click(targetTable.parentElement?.querySelector('[data-slot="combobox-trigger"]') as HTMLElement);
        popup = (await screen.findByRole('option', { name: 'dwd_orders' }))
            .closest('[data-slot="combobox-content"]');
        expect(popup?.className).toContain('min-w-[280px]');
    });

    it('renders database controls before tables and keeps Hive partitions separate', () => {
        render(<TransferNodeDialog groupId={1} value={validTransfer} onChange={vi.fn()} />);

        expect(screen.getAllByLabelText('数据库')).toHaveLength(2);
        expect(screen.getAllByLabelText('表')).toHaveLength(2);
        expect(screen.getByDisplayValue("status = 'ACTIVE'")).toBeTruthy();
        expect(screen.getByText('分区映射')).toBeTruthy();
        expect(screen.queryByRole('option', { name: 'Overwrite table' })).toBeNull();
    });

    it('renders source and target field details in a target-driven mapping matrix', () => {
        render(<TransferNodeDialog groupId={1} value={validTransfer} onChange={vi.fn()} />);

        const row = document.querySelector('[data-target-field="id"]');
        expect(row).toBeTruthy();
        expect(row?.textContent).toContain('来源订单编号');
        expect(row?.textContent).toContain('目标订单编号');
        expect(row?.textContent).toContain('BIGINT');
        expect(row?.textContent).toContain('主键');
    });

    it('explains parameter groups once for field and partition mappings', () => {
        render(<TransferNodeDialog groupId={1} value={validTransfer} onChange={vi.fn()} />);

        const mappingPanel = screen.getByRole('heading', { name: '字段映射' }).closest('section')!;
        expect(within(mappingPanel).getByText('在画布参数中绑定参数组。固定值（含分区）按文本填写，支持 ^[参数名] 插值，不加 SQL 引号；SQL 表达式中的参数仅作值占位符，不要加引号。不支持动态数据库、表或字段名。')).toBeTruthy();
        expect(screen.getAllByText(/在画布参数中绑定参数组/)).toHaveLength(1);
    });

    it.each([
        { kind: 'static_value', key: 'value', text: '^[v_day]' },
        { kind: 'static_value', key: 'value', text: 'day_^[v_day]' },
        { kind: 'source_expression', key: 'expression', text: 'CONCAT(id, ^[v_day])' },
    ] as const)('saves and restores $kind placeholders in mappings and partitions: $text', ({ kind, key, text }) => {
        const value: TransferConfig = {
            ...validTransfer,
            fieldMappings: [{ target: 'id', kind, [key]: 'id' }],
            partitions: [{ target: 'dayno', kind, [key]: 'id' }],
        };
        const onChange = vi.fn();
        const { unmount } = render(<TransferNodeDialog groupId={1} value={value} onChange={onChange} />);
        const fieldInput = screen.getByLabelText('id 映射值');
        const partitionInput = screen.getByLabelText('dayno 映射值');
        const placeholder = kind === 'static_value'
            ? '例如: 100、ACTIVE 或 ^[v_day]'
            : '例如: CONCAT(col, ^[suffix])';
        expect(fieldInput).toHaveProperty('placeholder', placeholder);
        expect(partitionInput).toHaveProperty('placeholder', placeholder);
        onChange.mockClear();

        const fieldMappings = [{ target: 'id', kind, [key]: text }];
        const partitions = [{ target: 'dayno', kind, [key]: text }];
        fireEvent.change(fieldInput, { target: { value: text } });
        expect(onChange).toHaveBeenLastCalledWith({ ...value, fieldMappings });
        fireEvent.change(partitionInput, { target: { value: text } });
        expect(onChange).toHaveBeenLastCalledWith({ ...value, fieldMappings, partitions });
        expect(fieldInput).toHaveProperty('value', text);
        expect(partitionInput).toHaveProperty('value', text);

        const persisted: TransferConfig = JSON.parse(JSON.stringify(onChange.mock.lastCall?.[0]));
        unmount();
        render(<TransferNodeDialog groupId={1} value={persisted} onChange={vi.fn()} />);
        expect(screen.getByLabelText('id 映射值')).toHaveProperty('value', text);
        expect(screen.getByLabelText('dayno 映射值')).toHaveProperty('value', text);
    });

    it('marks a mapping invalid when its configured source field no longer exists', () => {
        render(
            <TransferNodeDialog
                groupId={1}
                value={{
                    ...validTransfer,
                    fieldMappings: [{ target: 'id', kind: 'source_field', source: 'removed_source' }],
                }}
                onChange={vi.fn()}
            />,
        );

        const row = document.querySelector('[data-target-field="id"]');
        expect(row?.classList.contains('is-invalid')).toBe(true);
        expect(row?.textContent).toContain('来源字段 removed_source 已不存在');
    });

    it('shows an inline error after an empty source expression is touched', () => {
        render(
            <TransferNodeDialog
                groupId={1}
                value={{
                    ...validTransfer,
                    fieldMappings: [{ target: 'id', kind: 'source_expression', expression: '' }],
                }}
                onChange={vi.fn()}
            />,
        );

        const input = screen.getByLabelText('id 映射值');
        fireEvent.blur(input);

        expect(input.getAttribute('aria-invalid')).toBe('true');
        expect(screen.getByText('请输入SQL 表达式')).toBeTruthy();
        expect(document.querySelector('[data-target-field="id"]')?.classList.contains('is-invalid')).toBe(true);
    });

    it('refreshes source and target field structures together', () => {
        render(<TransferNodeDialog groupId={1} value={validTransfer} onChange={vi.fn()} />);

        fireEvent.click(screen.getByRole('button', { name: '刷新字段结构' }));

        expect(metadata.source.metadata.retry).toHaveBeenCalledOnce();
        expect(metadata.target.metadata.retry).toHaveBeenCalledOnce();
    });

    it('keeps a removed target mapping visible until the user removes it', () => {
        render(
            <TransferNodeDialog
                groupId={1}
                value={{
                    ...validTransfer,
                    fieldMappings: [
                        ...(validTransfer.fieldMappings ?? []),
                        { target: 'removed_target', kind: 'source_field', source: 'id' },
                    ],
                }}
                onChange={vi.fn()}
            />,
        );

        const staleRow = document.querySelector('[data-target-field="removed_target"]');
        expect(staleRow?.classList.contains('is-invalid')).toBe(true);
        expect(staleRow?.textContent).toContain('目标字段已不存在');
        expect(screen.getByRole('button', { name: '移除 removed_target 失效映射' })).toBeTruthy();
    });

    it('uses an anchored custom popup for mapping types', async () => {
        render(<TransferNodeDialog groupId={1} value={validTransfer} onChange={vi.fn()} />);

        const mappingType = screen.getByLabelText('id 映射类型');
        expect(mappingType.tagName).toBe('BUTTON');
        expect(mappingType.textContent).toContain('源字段');

        fireEvent.click(mappingType);

        const staticValue = await screen.findByRole('option', { name: '固定值' });
        expect(staticValue.closest('[data-slot="select-content"]')).toBeTruthy();
        fireEvent.mouseMove(staticValue);
        fireEvent.click(staticValue);

        await waitFor(() => {
            expect(mappingType.textContent).toContain('固定值');
            expect(mappingType.textContent).not.toContain('static_value');
        });
    });

    it('uses an anchored custom popup for write modes', async () => {
        render(<TransferNodeDialog groupId={1} value={validTransfer} onChange={vi.fn()} />);

        const writeMode = screen.getByLabelText('写入方式');
        expect(writeMode.tagName).toBe('BUTTON');
        expect(writeMode.textContent).toContain('Append');

        fireEvent.click(writeMode);

        const overwritePartition = await screen.findByRole('option', { name: 'Overwrite partition' });
        expect(overwritePartition.closest('[data-slot="select-content"]')).toBeTruthy();
    });

    it('presents a compact WHERE editor and saves value placeholders verbatim', () => {
        const onChange = vi.fn();
        render(<TransferNodeDialog groupId={1} value={validTransfer} onChange={onChange} />);

        expect(screen.getByText('过滤条件（可选）')).toBeTruthy();
        expect(screen.getByText('WHERE')).toBeTruthy();
        expect(screen.getByText('只填写 WHERE 后面的条件，语法按来源数据库执行。支持 ^[参数名] 值占位符，不要加引号。')).toBeTruthy();
        expect(screen.getByRole('button', { name: '展开过滤条件' })).toBeTruthy();
        onChange.mockClear();

        const where = 'created_at >= ^[v_day]';
        const filter = screen.getByLabelText('过滤条件（可选）');
        fireEvent.change(filter, { target: { value: where } });
        expect(filter).toHaveProperty('value', where);
        expect(onChange).toHaveBeenLastCalledWith({
            ...validTransfer,
            source: { ...validTransfer.source, where },
        });
    });

    it('validates an accidental WHERE prefix after leaving the filter editor', () => {
        render(<TransferNodeDialog groupId={1} value={validTransfer} onChange={vi.fn()} />);

        const filter = screen.getByLabelText('过滤条件（可选）');
        fireEvent.change(filter, { target: { value: "WHERE status = 'ACTIVE'" } });
        expect(screen.queryByText('无需填写 WHERE，请从字段条件开始。')).toBeNull();

        fireEvent.blur(filter);
        expect(screen.getByText('无需填写 WHERE，请从字段条件开始。')).toBeTruthy();
    });

    it('shows neutral mapping guidance while an endpoint is incomplete', () => {
        render(
            <TransferNodeDialog
                groupId={1}
                value={{
                    source: { dataSourceId: 0, dataSourceType: 'MYSQL', table: '' },
                    target: validTransfer.target,
                    fieldMappings: [],
                    partitions: [],
                }}
                onChange={vi.fn()}
            />,
        );

        expect(screen.getByText('完成来源和目标配置后生成字段映射')).toBeTruthy();
        expect(screen.getByText('系统会按目标表字段自动匹配同名源字段。')).toBeTruthy();
        expect(document.querySelector('.transfer-node-errors')).toBeNull();
        expect(screen.queryByText(/尚未配置映射/)).toBeNull();
    });

    it('groups endpoint selectors into compact primary and secondary rows', () => {
        render(<TransferNodeDialog groupId={1} value={validTransfer} onChange={vi.fn()} />);

        const sourcePanel = screen.getByRole('heading', { name: '来源' }).closest('section');
        const targetPanel = screen.getByRole('heading', { name: '目标' }).closest('section');

        expect(sourcePanel?.querySelector('.transfer-node-connection-fields')?.querySelectorAll('label')).toHaveLength(3);
        expect(targetPanel?.querySelector('.transfer-node-connection-fields')?.querySelectorAll('label')).toHaveLength(3);
        expect(sourcePanel?.querySelector('.transfer-node-secondary-fields')?.querySelectorAll('label')).toHaveLength(1);
        expect(targetPanel?.querySelector('.transfer-node-secondary-fields')?.querySelectorAll('label')).toHaveLength(1);
    });

    it('automatically selects configured default databases', async () => {
        const onDraftChange = vi.fn();
        render(
            <TransferNodeDialog
                groupId={1}
                value={{
                    source: { dataSourceId: 1, dataSourceType: 'MYSQL', table: '' },
                    target: { dataSourceId: 2, dataSourceType: 'HIVE', table: '', writeMode: 'append' },
                    fieldMappings: [],
                    partitions: [],
                }}
                onChange={vi.fn()}
                onDraftChange={onDraftChange}
            />,
        );

        await waitFor(() => {
            expect(onDraftChange).toHaveBeenLastCalledWith(
                expect.objectContaining({
                    source: expect.objectContaining({ database: 'transfer_demo' }),
                    target: expect.objectContaining({ database: 'default' }),
                }),
                expect.any(Object),
            );
        });
    });

    it('keeps reconciled mappings when the parent echoes draft updates', async () => {
        const legacyTransfer: TransferConfig = {
            source: { dataSourceId: 1, dataSourceType: 'MYSQL', table: 'orders' },
            target: { dataSourceId: 2, dataSourceType: 'HIVE', table: 'dwd_orders', writeMode: 'append' },
            fieldMappings: [],
            partitions: [],
        };
        const metadataBeforeDatabaseSelection: MockTransferMetadata = {
            ...metadata,
            source: { ...metadata.source, metadata: resource(null) },
            target: { ...metadata.target, metadata: resource(null) },
        };
        resolveMetadata = (args) => args[2] && args[5]
            ? metadata
            : metadataBeforeDatabaseSelection;

        function EchoingParent() {
            const [value, setValue] = useState(legacyTransfer);
            return (
                <TransferNodeDialog
                    groupId={1}
                    value={value}
                    onChange={vi.fn()}
                    onDraftChange={(draft) => setValue(draft)}
                />
            );
        }

        render(<EchoingParent />);

        await waitFor(() => {
            expect(screen.getByLabelText('id 源字段')).toHaveProperty('value', 'id');
            expect(screen.getAllByLabelText('数据库')[0]).toHaveProperty('value', 'transfer_demo');
            expect(screen.getAllByLabelText('数据库')[1]).toHaveProperty('value', 'default');
        });
    });

    it('does not report the transient empty mapping state when metadata is ready', async () => {
        const onDraftChange = vi.fn();

        render(
            <TransferNodeDialog
                groupId={1}
                value={{ ...validTransfer, fieldMappings: [], partitions: [] }}
                onChange={vi.fn()}
                onDraftChange={onDraftChange}
            />,
        );

        await waitFor(() => {
            expect(screen.getByLabelText('id 源字段')).toHaveProperty('value', 'id');
        });
        expect(onDraftChange).toHaveBeenCalled();
        expect(onDraftChange.mock.calls[0]).toEqual([
            expect.objectContaining({
                fieldMappings: [{ target: 'id', kind: 'source_field', source: 'id' }],
            }),
            expect.objectContaining({ valid: true }),
        ]);
    });

    it('preserves an unavailable saved database and requires replacement', async () => {
        render(
            <TransferNodeDialog
                groupId={1}
                value={{
                    ...validTransfer,
                    source: { ...validTransfer.source, database: 'removed' },
                }}
                onChange={vi.fn()}
            />,
        );

        expect(screen.getAllByLabelText('数据库')[0]).toHaveProperty('value', 'removed（不可用）');
        expect(screen.getByText('已保存的来源数据库不可用，请重新选择')).toBeTruthy();
    });

    it('clears the table and mappings when a database changes', async () => {
        const onDraftChange = vi.fn();
        render(
            <TransferNodeDialog
                groupId={1}
                value={validTransfer}
                onChange={vi.fn()}
                onDraftChange={onDraftChange}
            />,
        );

        const sourceDatabase = screen.getAllByLabelText('数据库')[0];
        fireEvent.click(sourceDatabase.parentElement?.querySelector('[data-slot="combobox-trigger"]') as HTMLElement);
        fireEvent.change(sourceDatabase, { target: { value: 'arch' } });
        fireEvent.click(await screen.findByRole('option', { name: 'archive' }));

        await waitFor(() => {
            expect(onDraftChange).toHaveBeenLastCalledWith(
                expect.objectContaining({
                    source: expect.objectContaining({ database: 'archive', table: '' }),
                    fieldMappings: [],
                    partitions: [],
                }),
                expect.any(Object),
            );
        });
    });

    it('disables tables and retries a failed database request', () => {
        const retry = vi.fn();
        metadata = {
            ...metadata,
            source: {
                ...metadata.source,
                databases: resource([], { error: '数据库加载失败', retry }),
                tables: pagedResource([]),
            },
        };
        render(<TransferNodeDialog groupId={1} value={validTransfer} onChange={vi.fn()} />);

        expect(screen.getAllByLabelText('表')[0]).toHaveProperty('disabled', true);
        fireEvent.click(screen.getByRole('button', { name: '重试来源数据库' }));
        expect(retry).toHaveBeenCalledOnce();
    });

    it('preserves the database and retries a failed table request', () => {
        const retry = vi.fn();
        metadata = {
            ...metadata,
            source: {
                ...metadata.source,
                tables: pagedResource([], { error: '表加载失败', retry }),
            },
        };
        render(<TransferNodeDialog groupId={1} value={validTransfer} onChange={vi.fn()} />);

        expect(screen.getAllByLabelText('数据库')[0]).toHaveProperty('value', 'transfer_demo');
        fireEvent.click(screen.getByRole('button', { name: '重试来源表' }));
        expect(retry).toHaveBeenCalledOnce();
    });

    it('shows metadata loading and retries the side that failed', () => {
        const retry = vi.fn();
        metadata = {
            ...metadata,
            source: {
                ...metadata.source,
                metadata: resource(null, { loading: true }),
            },
            target: {
                ...metadata.target,
                metadata: resource(null, { error: '字段元数据加载失败', retry }),
            },
        };
        render(<TransferNodeDialog groupId={1} value={validTransfer} onChange={vi.fn()} />);

        expect(screen.getByText('正在加载来源字段')).toBeTruthy();
        expect(screen.getByText('目标字段元数据加载失败')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: '重试目标字段' }));
        expect(retry).toHaveBeenCalledOnce();
    });

    it('renders an explicit empty state when the target has no transferable columns', () => {
        metadata = {
            ...metadata,
            target: {
                ...metadata.target,
                metadata: resource({ ...targetMetadata, columns: [], partitionColumns: [], partitioned: false }),
            },
        };
        render(<TransferNodeDialog groupId={1} value={validTransfer} onChange={vi.fn()} />);

        expect(screen.getByText('目标表没有可传输字段')).toBeTruthy();
    });

    it('renders an unmapped target field beside its row and blocks valid output', async () => {
        metadata = {
            ...metadata,
            target: {
                ...metadata.target,
                metadata: resource({
                    ...targetMetadata,
                    columns: [
                        ...targetMetadata.columns,
                        { name: 'amount', type: 'DECIMAL', size: 0, nullable: true, remarks: '', primaryKey: false },
                    ],
                }),
            },
        };
        const onChange = vi.fn();
        render(<TransferNodeDialog groupId={1} value={validTransfer} onChange={onChange} />);

        expect(await screen.findByText('1 个目标字段待映射')).toBeTruthy();
        expect(screen.queryByText('请选择来源字段或配置映射值')).toBeNull();

        fireEvent.blur(screen.getByLabelText('amount 源字段'));
        expect(screen.getByText('请选择来源字段')).toBeTruthy();
        expect(onChange).not.toHaveBeenCalled();
    });

    it('defaults same-name mappings when source metadata arrives after target metadata', async () => {
        metadata = {
            ...metadata,
            source: { ...metadata.source, metadata: resource(null, { loading: true }) },
            target: {
                ...metadata.target,
                metadata: resource({ ...targetMetadata, partitioned: false, partitionColumns: [] }),
            },
        };
        const onChange = vi.fn();
        const { rerender } = render(
            <TransferNodeDialog
                groupId={1}
                value={{ ...validTransfer, fieldMappings: [], partitions: [] }}
                onChange={onChange}
            />,
        );

        expect(screen.getByText('正在加载来源字段')).toBeTruthy();
        onChange.mockClear();
        metadata = {
            ...metadata,
            source: { ...metadata.source, metadata: resource(sourceMetadata) },
        };
        rerender(
            <TransferNodeDialog
                groupId={1}
                value={{ ...validTransfer, fieldMappings: [], partitions: [] }}
                onChange={onChange}
            />,
        );

        await waitFor(() => {
            expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
                fieldMappings: [{ target: 'id', kind: 'source_field', source: 'id' }],
            }));
        });
    });

    it('does not emit overwrite_table for partitioned Hive metadata before reconciliation', async () => {
        metadata = {
            ...metadata,
            target: {
                ...metadata.target,
                metadata: resource({
                    ...targetMetadata,
                    writeModes: [
                        { value: 'append', label: 'Append' },
                        { value: 'overwrite_table', label: 'Overwrite table' },
                        { value: 'overwrite_partition', label: 'Overwrite partition' },
                    ],
                }),
            },
        };
        const onChange = vi.fn();

        render(
            <TransferNodeDialog
                groupId={1}
                value={{
                    ...validTransfer,
                    target: { ...validTransfer.target, writeMode: 'overwrite_table' },
                }}
                onChange={onChange}
            />,
        );

        await waitFor(() => {
            expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
                target: expect.objectContaining({ writeMode: 'append' }),
            }));
        });
        expect(onChange.mock.calls).not.toEqual(expect.arrayContaining([
            [expect.objectContaining({ target: expect.objectContaining({ writeMode: 'overwrite_table' }) })],
        ]));
    });
});
