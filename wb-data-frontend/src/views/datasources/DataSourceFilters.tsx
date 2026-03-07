import { ChangeEventHandler, CompositionEventHandler } from 'react';
import { Plus, RotateCcw, Search, SlidersHorizontal } from 'lucide-react';
import { DataSourceSelect } from '../../components/DataSourceSelect';
import { STATUS_FILTER_OPTIONS } from './config';

type TypeOption = {
    label: string;
    value: string;
};

interface DataSourceFiltersProps {
    activeFilterCount: number;
    keywordInput: string;
    onKeywordInputChange: (value: string) => void;
    onTypeChange: (value: string[]) => void;
    onStatusChange: (value: string) => void;
    onReset: () => void;
    selectedTypes: string[];
    selectedStatus: string;
    typeOptions: TypeOption[];
    onCompositionStart: CompositionEventHandler<HTMLInputElement>;
    onCompositionEnd: CompositionEventHandler<HTMLInputElement>;
}

export function DataSourceFilters(props: DataSourceFiltersProps) {
    const {
        activeFilterCount,
        keywordInput,
        onKeywordInputChange,
        onTypeChange,
        onStatusChange,
        onReset,
        selectedTypes,
        selectedStatus,
        typeOptions,
        onCompositionStart,
        onCompositionEnd,
    } = props;

    const handleChange: ChangeEventHandler<HTMLInputElement> = (event) => {
        onKeywordInputChange(event.target.value);
    };

    return (
        <div className="datasource-filters">
            <div className="datasource-filter-stack datasource-filter-search">
                <label className="datasource-filter-label">关键词检索</label>
                <div className="datasource-search">
                    <Search size={16} />
                    <input
                        placeholder="搜索名称、描述、主机名"
                        value={keywordInput}
                        onChange={handleChange}
                        onCompositionStart={onCompositionStart}
                        onCompositionEnd={onCompositionEnd}
                    />
                </div>
            </div>

            <div className="datasource-filter-stack datasource-filter-type">
                <label className="datasource-filter-label">数据源类型</label>
                <DataSourceSelect
                    multiple={true}
                    onChange={onTypeChange}
                    options={typeOptions}
                    placeholder="选择一种或多种类型"
                    value={selectedTypes}
                />
            </div>

            <div className="datasource-filter-stack datasource-filter-status">
                <label className="datasource-filter-label">
                    <SlidersHorizontal size={15} />
                    状态过滤
                </label>
                <div className="datasource-status-row">
                    {STATUS_FILTER_OPTIONS.map((option) => (
                        <button
                            key={option.value || 'ALL'}
                            className={`datasource-status-chip ${selectedStatus === option.value ? 'active' : ''}`}
                            onClick={() => onStatusChange(option.value)}
                            type="button"
                        >
                            {option.label}
                        </button>
                    ))}
                </div>
            </div>

            <div className="datasource-filter-stack datasource-filter-actions">
                <label className="datasource-filter-label">当前工作流</label>
                <div className="datasource-filter-meta">
                    <div className="datasource-filter-badge">
                        <Plus size={15} />
                        已激活 {activeFilterCount} 个筛选条件
                    </div>
                    <button className="datasource-text-btn" onClick={onReset} type="button">
                        <RotateCcw size={15} />
                        重置筛选
                    </button>
                </div>
            </div>
        </div>
    );
}
