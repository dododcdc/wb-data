import { useState } from 'react';
import { Search, ArrowDown } from 'lucide-react';

interface LogToolbarProps {
    levelCounts: { ERROR: number; WARN: number; INFO: number };
    activeLevels: Set<string>;
    onToggleLevel: (level: string) => void;
    onSearch: (query: string) => void;
    onScrollToBottom: () => void;
    isAtBottom: boolean;
}

const LEVELS = ['ERROR', 'WARN', 'INFO'] as const;

export default function LogToolbar({
    levelCounts,
    activeLevels,
    onToggleLevel,
    onSearch,
    onScrollToBottom,
    isAtBottom,
}: LogToolbarProps) {
    const [searchValue, setSearchValue] = useState('');

    const handleSearch = () => {
        onSearch(searchValue.trim());
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') handleSearch();
    };

    return (
        <div className="log-toolbar">
            <div className="log-toolbar-levels">
                {LEVELS.map((level) => {
                    const count = levelCounts[level] ?? 0;
                    const active = activeLevels.size === 0 || activeLevels.has(level);
                    return (
                        <button
                            key={level}
                            type="button"
                            className={`log-toolbar-chip is-${level.toLowerCase()}${!active ? ' is-dimmed' : ''}`}
                            onClick={() => onToggleLevel(level)}
                        >
                            {level}:{count}
                        </button>
                    );
                })}
            </div>
            <div className="log-toolbar-right">
                <div className="log-toolbar-search">
                    <input
                        type="text"
                        placeholder="搜索日志..."
                        value={searchValue}
                        onChange={(e) => setSearchValue(e.target.value)}
                        onKeyDown={handleKeyDown}
                        className="log-toolbar-search-input"
                    />
                    <button type="button" className="log-toolbar-search-btn" onClick={handleSearch}>
                        <Search size={14} />
                    </button>
                </div>
                {!isAtBottom && (
                    <button type="button" className="log-toolbar-scroll-btn" onClick={onScrollToBottom} title="滚动到最新">
                        <ArrowDown size={14} />
                    </button>
                )}
            </div>
        </div>
    );
}
