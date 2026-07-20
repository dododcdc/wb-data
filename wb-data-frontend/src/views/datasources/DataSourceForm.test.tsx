import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DataSourceForm from './DataSourceForm';

const {
    createDataSource,
    getDataSourceById,
    getDataSourcePlugins,
    testNewConnection,
    updateDataSource,
} = vi.hoisted(() => ({
    createDataSource: vi.fn(),
    getDataSourceById: vi.fn(),
    getDataSourcePlugins: vi.fn(),
    testNewConnection: vi.fn(),
    updateDataSource: vi.fn(),
}));

vi.mock('../../api/datasource', () => ({
    createDataSource,
    getDataSourceById,
    getDataSourcePlugins,
    testNewConnection,
    updateDataSource,
}));

vi.mock('../../components/SimpleSelect', () => ({
    SimpleSelect: ({
        value,
        options,
        onChange,
        id,
    }: {
        value?: string;
        options: { label: string; value: string }[];
        onChange: (value: string) => void;
        id?: string;
    }) => (
        <select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
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

function renderForm() {
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
});
