// wb-data-frontend/src/views/offline/LogToolbar.tsx
import { useState, useCallback } from 'react';
import { Search, ArrowDownToLine, X } from 'lucide-react';

interface LogToolbarProps {
    levelCounts: { ERROR: number; WARN: number; INFO: number };
    activeLevels: Set<string>;
    onToggleLevel: (level: string) => void;
    onSearch: (query: string) => void;
    onScrollToBottom: () => void;
    isAtBottom: boolean;
}

const LEVELS = [
    { key: 'ERROR', label: 'ERROR', cls: 'is-error' },
    { key: 'WARN', label: 'WARN', cls: 'is-warn' },
    { key: 'INFO', label: 'INFO', cls: 'is-info' },
] as const;

export default function LogToolbar({
    levelCounts,
    activeLevels,
    onToggleLevel,
    onSearch,
    onScrollToBottom,
    isAtBottom,
}: LogToolbarProps) {
    const [searchValue, setSearchValue] = useState('');

    const handleSearchSubmit = useCallback(() => {
        onSearch(searchValue.trim());
    }, [searchValue, onSearch]);

    const handleSearchKeyDown = useCallback(
        (e: React.KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter') {
                handleSearchSubmit();
            }
        },
        [handleSearchSubmit],
    );

    const handleClearSearch = useCallback(() => {
        setSearchValue('');
        onSearch('');
    }, [onSearch]);

    const anyFilterActive = activeLevels.size > 0;

    return (
        <div className="log-toolbar">
            <div className="log-toolbar-levels">
                {LEVELS.map(({ key, label, cls }) => {
                    const dimmed = anyFilterActive && !activeLevels.has(key);
                    return (
                        <button
                            key={key}
                            type="button"
                            className={`log-toolbar-chip ${cls}${dimmed ? ' is-dimmed' : ''}`}
                            onClick={() => onToggleLevel(key)}
                        >
                            {label} {levelCounts[key] ?? 0}
                        </button>
                    );
                })}
            </div>

            <div className="log-toolbar-right">
                <div className="log-toolbar-search">
                    <input
                        type="text"
                        className="log-toolbar-search-input"
                        placeholder="搜索日志..."
                        value={searchValue}
                        onChange={(e) => setSearchValue(e.target.value)}
                        onKeyDown={handleSearchKeyDown}
                    />
                    {searchValue && (
                        <button type="button" className="log-toolbar-search-btn" onClick={handleClearSearch}>
                            <X size={12} />
                        </button>
                    )}
                    <button type="button" className="log-toolbar-search-btn" onClick={handleSearchSubmit}>
                        <Search size={12} />
                    </button>
                </div>
                {!isAtBottom && (
                    <button type="button" className="log-toolbar-scroll-btn" onClick={onScrollToBottom}>
                        <ArrowDownToLine size={12} />
                    </button>
                )}
            </div>
        </div>
    );
}
