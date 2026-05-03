import { useState, useMemo, useEffect } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';

interface PageResult<T> {
    records: T[];
    total: number;
    size: number;
    current: number;
    pages: number;
}

interface UseDataTableOptions<T, TParams> {
    queryKey: any[];
    fetchFn: (params: TParams & { page: number; size: number; keyword?: string }) => Promise<PageResult<T>>;
    defaultParams?: Partial<TParams>;
    initialPageSize?: number;
    syncWithUrl?: boolean;
}

export function useDataTable<T, TParams = {}>({
    queryKey,
    fetchFn,
    defaultParams = {} as TParams,
    initialPageSize = 10,
    syncWithUrl = false,
}: UseDataTableOptions<T, TParams>) {
    const [searchParams, setSearchParams] = useSearchParams();

    // 初始化状态时优先从 URL 读取
    const initialPage = syncWithUrl ? Number(searchParams.get('page')) || 1 : 1;
    const initialKeyword = syncWithUrl ? searchParams.get('keyword') || '' : '';
    const initialSize = syncWithUrl ? Number(searchParams.get('size')) || initialPageSize : initialPageSize;

    const [page, setPage] = useState(initialPage);
    const [pageSize, setPageSize] = useState(initialSize);
    const [keyword, setKeyword] = useState(initialKeyword);
    const [params, setParams] = useState<TParams>(defaultParams as TParams);

    const queryParams = useMemo(() => ({
        ...params,
        page,
        size: pageSize,
        keyword: keyword.trim() || undefined,
    }), [params, page, pageSize, keyword]);

    // 当状态改变时更新 URL
    useEffect(() => {
        if (!syncWithUrl) return;

        const next = new URLSearchParams(searchParams);
        if (page > 1) next.set('page', String(page)); else next.delete('page');
        if (pageSize !== initialPageSize) next.set('size', String(pageSize)); else next.delete('size');
        if (keyword.trim()) next.set('keyword', keyword.trim()); else next.delete('keyword');

        if (next.toString() !== searchParams.toString()) {
            setSearchParams(next, { replace: true });
        }
    }, [page, pageSize, keyword, syncWithUrl, setSearchParams, searchParams, initialPageSize]);

    const query = useQuery({
        queryKey: [...queryKey, queryParams],
        queryFn: () => fetchFn(queryParams),
        placeholderData: keepPreviousData,
    });

    return {
        ...query,
        data: query.data?.records ?? [],
        total: query.data?.total ?? 0,
        pagination: {
            page,
            pageSize,
            setPage,
            setPageSize,
            totalPages: query.data?.pages ?? 0,
        },
        search: {
            keyword,
            setKeyword: (val: string) => {
                setKeyword(val);
                setPage(1);
            },
        },
        refresh: query.refetch,
        setExtraParams: (newParams: Partial<TParams>) => {
            setParams(prev => ({ ...prev, ...newParams }));
            setPage(1);
        },
    };
}
