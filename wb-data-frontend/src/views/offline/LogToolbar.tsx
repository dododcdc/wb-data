// wb-data-frontend/src/views/offline/LogToolbar.tsx
import { useState, useCallback } from 'react';
import { ArrowDownToLine, X, ChevronUp, ChevronDown } from 'lucide-react';

interface LogToolbarProps {
    levelCounts: { ERROR: number; WARN: number; INFO: number };
    activeLevels: Set<string>;
    onToggleLevel: (level: string) => void;
    onSearch: (query: string) => void;
    onScrollToBottom: () => void;
    isAtBottom: boolean;
    matchCount: number;
    currentMatchIndex: number;
    onNextMatch: () => void;
    onPrevMatch: () => void;
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
    matchCount,
    currentMatchIndex,
    onNextMatch,
    onPrevMatch,
}: LogToolbarProps) {
    const [searchValue, setSearchValue] = useState('');

    const handleSearchKeyDown = useCallback(
        (e: React.KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter') {
                if (e.shiftKey) {
                    onPrevMatch();
                } else {
                    if (searchValue.trim()) {
                        onSearch(searchValue.trim());
                    }
                }
            }
        },
        [searchValue, onSearch, onPrevMatch],
    );

    const handleClearSearch = useCallback(() => {
        setSearchValue('');
        onSearch('');
    }, [onSearch]);

    const anyFilterActive = activeLevels.size > 0;
    const hasMatches = matchCount > 0;

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
                    {hasMatches && (
                        <span className="log-toolbar-match-info">
                            {currentMatchIndex + 1}/{matchCount}
                        </span>
                    )}
                    <button
                        type="button"
                        className="log-toolbar-search-btn"
                        disabled={!hasMatches}
                        onClick={onPrevMatch}
                        title="上一个匹配 (Shift+Enter)"
                    >
                        <ChevronUp size={12} />
                    </button>
                    <button
                        type="button"
                        className="log-toolbar-search-btn"
                        disabled={!hasMatches}
                        onClick={onNextMatch}
                        title="下一个匹配 (Enter)"
                    >
                        <ChevronDown size={12} />
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
