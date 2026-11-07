import type { QueryResult } from '../../../api/query';
import { DataList, type DataListColumn } from '../../../components/ui/list/DataList';

export function QueryResultGrid({ result }: { result: QueryResult }) {
    const columns: DataListColumn<Record<string, unknown>>[] = result.columns.map((column) => ({
        key: column.name,
        header: (
            <div className="th-content">
                <span className="th-name">{column.name}</span>
                <span className="th-type">{column.type}</span>
            </div>
        ),
        truncate: true,
        cell: (row) => {
            const value = String(row[column.name] ?? '');
            return <span title={value}>{value}</span>;
        },
    }));

    return (
        <DataList
            rows={result.rows}
            columns={columns}
            rowKey={(_row, index) => index}
            ariaLabel="SQL 查询结果"
            minWidth="100%"
            className="wb-query-data-grid"
        />
    );
}
