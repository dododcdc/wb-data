export interface OperationsTimeFilterProps {
    from: string;
    to: string;
    onChange: (from: string, to: string) => void;
}

export function OperationsTimeFilter({ from, to }: OperationsTimeFilterProps) {
    return (
        <button type="button" aria-label={`时间范围 ${from} 至 ${to}`}>
            {from} → {to}
        </button>
    );
}
