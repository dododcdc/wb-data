import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DataSourceForm from './DataSourceForm';

const {
    createDataSource,
    getDataSourceById,
    getDataSourcePlugins,
    testExistingConnection,
    testNewConnection,
    updateDataSource,
} = vi.hoisted(() => ({
    createDataSource: vi.fn(),
    getDataSourceById: vi.fn(),
    getDataSourcePlugins: vi.fn(),
    testExistingConnection: vi.fn(),
    testNewConnection: vi.fn(),
    updateDataSource: vi.fn(),
}));

vi.mock('../../api/datasource', () => ({
    createDataSource,
    getDataSourceById,
    getDataSourcePlugins,
    testExistingConnection,
    testNewConnection,
    updateDataSource,
}));

vi.mock('../../components/SimpleSelect', () => ({
    SimpleSelect: ({
        value,
        options,
        onChange,
        id,
        disabled,
    }: {
        value?: string;
        options: { label: string; value: string }[];
        onChange: (value: string) => void;
        id?: string;
        disabled?: boolean;
    }) => (
        <select id={id} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
            {options.map((option) => (
                <option key={option.value} value={option.value}>
                    {option.label}
                </option>
            ))}
        </select>
    ),
}));

const hivePlugin = {
    type: 'HIVE',
    label: 'Hive',
    order: 20,
    helperText: '通过 HiveServer2 连接 Hive。',
    supportsConnectionTest: true,
    fields: [
        {
            key: 'host',
            section: 'connection',
            label: 'HiveServer2 地址',
            placeholder: 'hive-server.example.com',
            inputType: 'text',
            required: true,
            defaultValue: null,
        },
        {
            key: 'port',
            section: 'connection',
            label: '端口',
            placeholder: '10000',
            inputType: 'text',
            required: true,
            defaultValue: '10000',
        },
        {
            key: 'databaseName',
            section: 'connection',
            label: '默认数据库',
            placeholder: '如：default',
            inputType: 'text',
            required: true,
            defaultValue: 'default',
        },
        {
            key: 'metastoreUri',
            section: 'connectionParams',
            label: 'Hive Metastore URI',
            placeholder: 'thrift://host.docker.internal:9083',
            inputType: 'text',
            required: false,
            defaultValue: null,
        },
        {
            key: 'username',
            section: 'authentication',
            label: '用户名',
            placeholder: 'hive_user',
            inputType: 'text',
            required: true,
            defaultValue: null,
        },
        {
            key: 'password',
            section: 'authentication',
            label: '密码',
            placeholder: '未配置密码可留空',
            inputType: 'password',
            required: false,
            defaultValue: null,
        },
    ],
};

const existingHive = {
    id: 42,
    name: 'prod_hive',
    type: 'HIVE',
    description: '生产 Hive',
    host: 'hive.internal',
    port: 10000,
    databaseName: 'default',
    username: 'hive',
    connectionParams: { metastoreUri: 'thrift://metastore:9083' },
    status: 'ENABLED',
    owner: 'alice',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
};

function renderForm(props: { dataSourceId?: number | null; readOnly?: boolean } = {}) {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: { retry: false },
        },
    });

    return render(
        <QueryClientProvider client={queryClient}>
            <DataSourceForm
                open
                dataSourceId={null}
                groupId={4}
                onOpenChange={vi.fn()}
                onSuccess={vi.fn()}
                {...props}
            />
        </QueryClientProvider>,
    );
}

describe('DataSourceForm', () => {
    beforeEach(() => {
        getDataSourcePlugins.mockResolvedValue([hivePlugin]);
        getDataSourceById.mockResolvedValue(null);
        createDataSource.mockResolvedValue(true);
        updateDataSource.mockResolvedValue(true);
        testNewConnection.mockResolvedValue({ success: true, message: '连接成功' });
        testExistingConnection.mockResolvedValue({ success: true, message: '已有连接可用' });
    });

    afterEach(() => {
        cleanup();
        vi.clearAllMocks();
    });

    it('saves and tests Hive metastore URI as a connection param', async () => {
        renderForm();

        fireEvent.change(await screen.findByLabelText(/数据源名称/), {
            target: { value: 'it_transfer_hive' },
        });
        fireEvent.change(screen.getByLabelText(/HiveServer2 地址/), {
            target: { value: 'localhost' },
        });
        fireEvent.change(screen.getByLabelText(/用户名/), {
            target: { value: 'hive' },
        });
        fireEvent.change(screen.getByLabelText(/Hive Metastore URI/), {
            target: { value: 'thrift://host.docker.internal:9083' },
        });

        fireEvent.click(screen.getByRole('button', { name: '测试连接' }));

        await waitFor(() => {
            expect(testNewConnection).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: 'HIVE',
                    connectionParams: {
                        metastoreUri: 'thrift://host.docker.internal:9083',
                    },
                }),
                4,
            );
        });

        fireEvent.click(screen.getByRole('button', { name: '确认保存' }));

        await waitFor(() => {
            expect(createDataSource).toHaveBeenCalledWith(
                expect.objectContaining({
                    name: 'it_transfer_hive',
                    type: 'HIVE',
                    connectionParams: {
                        metastoreUri: 'thrift://host.docker.internal:9083',
                    },
                }),
                4,
            );
        });
    });

    it('opens existing datasource in read-only detail mode', async () => {
        getDataSourceById.mockResolvedValue(existingHive);
        renderForm({ dataSourceId: 42, readOnly: true });

        expect(await screen.findByText('数据源详情')).toBeTruthy();
        expect(await screen.findByText('标识与类型')).toBeTruthy();
        expect(screen.getByText('连接配置')).toBeTruthy();
        expect(screen.getByText('身份核验')).toBeTruthy();
        expect(await screen.findByText('prod_hive')).toBeTruthy();
        expect(screen.getByText('hive.internal')).toBeTruthy();
        expect(screen.getByText('生产 Hive')).toBeTruthy();
        expect(screen.getByText('alice')).toBeTruthy();
        expect(screen.getByText('••••••••')).toBeTruthy();
        expect(screen.getByText('thrift://metastore:9083')).toBeTruthy();
        expect(screen.queryByRole('textbox')).toBeNull();
        expect(screen.queryByRole('combobox')).toBeNull();
        expect(document.querySelector('input')).toBeNull();
        expect(document.querySelector('textarea')).toBeNull();
        expect(document.querySelector('select')).toBeNull();
        expect(screen.queryByRole('button', { name: '确认保存' })).toBeNull();
        expect(screen.getAllByRole('button', { name: '关闭' }).length).toBeGreaterThan(0);

        fireEvent.click(screen.getByRole('button', { name: '测试连接' }));

        await waitFor(() => {
            expect(testExistingConnection).toHaveBeenCalledWith(42, 4);
            expect(testNewConnection).not.toHaveBeenCalled();
        });
    });

    it('tests stored credentials when editing without a new password', async () => {
        getDataSourceById.mockResolvedValue(existingHive);
        renderForm({ dataSourceId: 42 });

        expect(await screen.findByDisplayValue('prod_hive')).toBeTruthy();
        expect(screen.getByRole('button', { name: /当前密码已保存/ })).toBeTruthy();
        expect(screen.queryByPlaceholderText('请输入新密码')).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: '测试连接' }));

        await waitFor(() => {
            expect(testExistingConnection).toHaveBeenCalledWith(42, 4);
            expect(testNewConnection).not.toHaveBeenCalled();
        });
    });

    it('tests new credentials when editing with a new password', async () => {
        getDataSourceById.mockResolvedValue(existingHive);
        renderForm({ dataSourceId: 42 });

        fireEvent.click(await screen.findByRole('button', { name: /当前密码已保存/ }));
        fireEvent.change(screen.getByLabelText(/^密码$/), {
            target: { value: 'new-secret' },
        });
        fireEvent.click(screen.getByRole('button', { name: '测试连接' }));

        await waitFor(() => {
            expect(testNewConnection).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: 'HIVE',
                    host: 'hive.internal',
                    username: 'hive',
                    password: 'new-secret',
                }),
                4,
            );
            expect(testExistingConnection).not.toHaveBeenCalled();
        });
    });
});
