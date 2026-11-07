import type { ParameterTimeBasis, ParameterValueSource } from '../../api/parameterGroups';
import { DataList, type DataListColumn } from '../../components/ui/list/DataList';

export interface ParameterPreviewItem {
    key: string;
    description: string | null;
    valueSource: ParameterValueSource;
    timeBasis: ParameterTimeBasis | null;
    ruleText: string;
    value: unknown;
}

function renderValue(value: unknown) {
    if (value == null) return 'null';
    if (typeof value === 'string') return value;
    return JSON.stringify(value);
}

export function ParameterPreviewGrid({ items }: { items: ParameterPreviewItem[] }) {
    const columns: DataListColumn<ParameterPreviewItem>[] = [
        {
            key: 'parameter',
            header: '参数名',
            primary: true,
            width: '32%',
            cell: (item) => (
                <div className="parameter-preview-key-cell">
                    <code className="parameter-preview-key">{item.key}</code>
                    {item.description ? <span className="parameter-preview-desc">{item.description}</span> : null}
                </div>
            ),
        },
        {
            key: 'rule',
            header: '取值规则',
            width: '38%',
            cell: (item) => (
                <div className="parameter-preview-rule-cell">
                    <span className={`parameter-preview-source-badge is-${item.valueSource.toLowerCase()}`}>
                        {item.valueSource === 'CONSTANT' ? '固定值' : '运行时日期'}
                    </span>
                    <span className="parameter-preview-rule-text">{item.ruleText}</span>
                </div>
            ),
        },
        {
            key: 'value',
            header: '示例推演值',
            truncate: true,
            width: '30%',
            cell: (item) => (
                <code className="parameter-preview-value" title={item.value === undefined ? '待计算' : renderValue(item.value)}>
                    {item.value === undefined ? '待计算' : renderValue(item.value)}
                </code>
            ),
        },
    ];

    return (
        <DataList
            rows={items}
            columns={columns}
            rowKey={(item) => item.key}
            ariaLabel="参数预览列表"
            minWidth="620px"
            className="wb-parameter-preview-grid wb-list-compact"
        />
    );
}
