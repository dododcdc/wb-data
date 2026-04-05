/**
 * Query 页面数据库选择 hook
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { getMetadataDatabases, DialectMetadata, getDialectMetadata } from '../../../api/datasource';
import { mergeDatabaseOptions } from '../storageUtils';

// ==================== Hook 返回值 ====================

export interface UseDatabaseReturn {
    // State
    databases: string[];
    selectedDb: string;
    dbKeyword: string;
    loadingDatabases: boolean;
    dialectMetadata: DialectMetadata | null;

    // Setters
    setDatabases: (dbs: string[]) => void;
    setSelectedDb: (db: string) => void;
    setDbKeyword: (keyword: string) => void;
    setLoadingDatabases: (loading: boolean) => void;
    setDialectMetadata: (meta: DialectMetadata | null) => void;

    // Data operations
    loadDatabases: (dsId: number, preferredDb?: string) => Promise<void>;
    loadDialect: (id: number) => Promise<void>;
    handleDatabaseChange: (db: string) => void;
    getMergedDatabaseOptions: (fallbackDb?: string) => string[];

    // Refs
    databasesRequestIdRef: React.MutableRefObject<number>;
    dialectRequestIdRef: React.MutableRefObject<number>;
}

// ==================== Hook ====================

export function useDatabase(): UseDatabaseReturn {
    const [databases, setDatabases] = useState<string[]>([]);
    const [selectedDb, setSelectedDb] = useState<string>('');
    const [dbKeyword, setDbKeyword] = useState('');
    const [loadingDatabases, setLoadingDatabases] = useState(false);
    const [dialectMetadata, setDialectMetadata] = useState<DialectMetadata | null>(null);

    const databasesRequestIdRef = useRef(0);
    const dialectRequestIdRef = useRef(0);

    // Load databases
    const loadDatabases = useCallback(async (dsId: number, preferredDb?: string) => {
        const requestId = ++databasesRequestIdRef.current;
        setLoadingDatabases(true);

        try {
            const data = await getMetadataDatabases(dsId);
            const merged = mergeDatabaseOptions(data, preferredDb);
            setDatabases(merged);
            if (preferredDb && merged.includes(preferredDb)) {
                setSelectedDb(preferredDb);
            } else if (merged.length === 1) {
                setSelectedDb(merged[0]);
            } else {
                setSelectedDb('');
            }
        } catch (error) {
            console.error('Failed to load databases', error);
            setDatabases([]);
            setSelectedDb('');
        } finally {
            if (requestId === databasesRequestIdRef.current) {
                setLoadingDatabases(false);
            }
        }
    }, []);

    // Load dialect metadata
    const loadDialect = useCallback(async (id: number) => {
        const requestId = ++dialectRequestIdRef.current;
        try {
            const data = await getDialectMetadata(id);
            if (requestId === dialectRequestIdRef.current) {
                setDialectMetadata(data);
            }
        } catch (error) {
            console.error('Failed to load dialect metadata', error);
            if (requestId === dialectRequestIdRef.current) {
                setDialectMetadata(null);
            }
        }
    }, []);

    // Handle database change
    const handleDatabaseChange = useCallback((db: string) => {
        setSelectedDb(db);
        setDbKeyword('');
    }, []);

    // Get merged database options
    const getMergedDatabaseOptions = useCallback((fallbackDb?: string) => {
        return mergeDatabaseOptions(databases, fallbackDb);
    }, [databases]);

    return {
        // State
        databases,
        selectedDb,
        dbKeyword,
        loadingDatabases,
        dialectMetadata,

        // Setters
        setDatabases,
        setSelectedDb,
        setDbKeyword,
        setLoadingDatabases,
        setDialectMetadata,

        // Data operations
        loadDatabases,
        loadDialect,
        handleDatabaseChange,
        getMergedDatabaseOptions,

        // Refs
        databasesRequestIdRef,
        dialectRequestIdRef,
    };
}
