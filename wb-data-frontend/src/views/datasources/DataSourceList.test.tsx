import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Link } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    getDataSourceOwners,
    getDataSourcePage,
    transferDataSourceOwner,
    type DataSource,
} from '../../api/datasource';
import { getGroupOwnerCandidates } from '../../api/groupSettings';
import { useAuthStore } from '../../utils/auth';
import DataSourceList from './DataSourceList';

vi.mock('../../api/datasource', () => ({
    getDataSourcePage: vi.fn(),
    getDataSourceOwners: vi.fn(),
    transferDataSourceOwner: vi.fn(),
    deleteDataSource: vi.fn(),
    testExistingConnection: vi.fn(),
    updateDataSourceStatus: vi.fn(),
}));
vi.mock('../../api/groupSettings', () => ({
    getGroupOwnerCandidates: vi.fn(),
}));
vi.mock('./DataSourceForm', () => ({ default: () => null }));
vi.mock('./DataSourceTable', () => ({ DataSourceTable: ({ data }: { data: DataSource[] }) => <div>{data.map((item) => <span key={item.id}>{item.name}</span>)}</div> }));

let client: QueryClient;
beforeEach(() => {
    useAuthStore.setState({
        userInfo: { id: 1, username: 'alice', displayName: 'Alice', systemRole: 'USER' },
        currentGroup: { id: 1, name: 'Alpha', description: '', role: 'DEVELOPER' },
        permissions: ['datasource.read', 'datasource.write'],
    });
    vi.mocked(getDataSourcePage).mockReset();
    vi.mocked(getDataSourceOwners).mockReset().mockResolvedValue([
        { userId: 1, username: 'alice', displayName: 'Alice', status: 'ACTIVE', count: 1 },
        { userId: 2, username: 'bob', displayName: 'Bob', status: 'ACTIVE', count: 2 },
    ]);
    vi.mocked(transferDataSourceOwner).mockReset().mockResolvedValue({
        updatedCount: 2,
        targetOwnerUserId: 1,
        targetOwnerName: 'Alice',
    });
    vi.mocked(getGroupOwnerCandidates).mockReset().mockResolvedValue([
        { userId: 1, username: 'alice', displayName: 'Alice', role: 'DEVELOPER' },
        { userId: 2, username: 'bob', displayName: 'Bob', role: 'GROUP_ADMIN' },
    ]);
});
afterEach(() => { cleanup(); client.clear(); });

function renderList() {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MemoryRouter>
        <Link to="/?page=2">?page=2</Link><Link to="/?keyword=new">?keyword=new</Link>
        <DataSourceList />
    </MemoryRouter></QueryClientProvider>);
}

const page = { records: [{ id: 1, name: 'Alpha source' } as DataSource], total: 20, pages: 2, size: 10, current: 1 };

describe('DataSourceList group isolation', () => {
    it.each([2, null])('does not retain the previous group list when group becomes %s', async (id) => {
        vi.mocked(getDataSourcePage).mockResolvedValueOnce(page).mockImplementation(() => new Promise(() => {}));
        renderList();
        await screen.findByText('Alpha source');
        act(() => useAuthStore.setState({ currentGroup: id ? { id, name: 'Beta', description: '', role: 'DEVELOPER' } : null }));
        expect(screen.queryByText('Alpha source')).toBeNull();
    });

    it('does not apply an old group response after the new group list has loaded', async () => {
        let resolve!: (result: typeof page) => void;
        vi.mocked(getDataSourcePage).mockReturnValueOnce(new Promise((done) => { resolve = done; }))
            .mockResolvedValue({ ...page, records: [{ id: 2, name: 'Beta source' } as DataSource] });
        renderList();
        await waitFor(() => expect(getDataSourcePage).toHaveBeenCalledTimes(1));
        act(() => useAuthStore.setState({ currentGroup: { id: 2, name: 'Beta', description: '', role: 'DEVELOPER' } }));
        await screen.findByText('Beta source');
        await act(async () => { resolve(page); });
        expect(screen.queryByText('Alpha source')).toBeNull();
        expect(screen.getByText('Beta source')).toBeTruthy();
    });

    it.each(['?page=2', '?keyword=new'])('retains data during same-group pagination/search %s', async (search) => {
        vi.mocked(getDataSourcePage).mockResolvedValueOnce(page).mockImplementation(() => new Promise(() => {}));
        renderList();
        await screen.findByText('Alpha source');
        fireEvent.click(screen.getByRole('link', { name: search }));
        await waitFor(() => expect(getDataSourcePage).toHaveBeenCalledTimes(2));
        expect(screen.getByText('Alpha source')).toBeTruthy();
    });

    it('filters by owner and supports bulk owner transfer', async () => {
        vi.mocked(getDataSourcePage).mockResolvedValue(page);
        renderList();
        await screen.findByText('Alpha source');

        fireEvent.click(screen.getByRole('combobox', { name: '按负责人筛选数据源' }));
        const bobOption = await screen.findByRole('option', { name: /Bob/ });
        fireEvent.mouseMove(bobOption);
        fireEvent.click(bobOption);

        await waitFor(() => {
            expect(getDataSourcePage).toHaveBeenLastCalledWith(
                expect.objectContaining({ ownerUserId: 2, page: 1 }),
            );
        });

        fireEvent.click(screen.getByRole('button', { name: '批量转移' }));
        expect(await screen.findByRole('dialog', { name: '批量移交数据源负责人' })).toBeTruthy();
        fireEvent.click(screen.getByRole('combobox', { name: '新负责人' }));
        const aliceTarget = await screen.findByRole('option', { name: 'Alice (@alice)' });
        fireEvent.mouseMove(aliceTarget);
        fireEvent.click(aliceTarget);
        fireEvent.click(screen.getByRole('button', { name: '确认转移' }));

        await waitFor(() => {
            expect(transferDataSourceOwner).toHaveBeenCalledWith(1, {
                fromOwnerUserId: 2,
                targetOwnerUserId: 1,
            });
        });
    });
});
