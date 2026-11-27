import { useContext, useEffect, useMemo, useState } from 'react';
import { QueryClientContext, useQuery } from '@tanstack/react-query';
import { getGroupOwnerCandidates, type GroupOwnerOption, type OwnerStatus } from '../../api/groupSettings';
import { SimpleSelect } from '../SimpleSelect';
import { formatCandidateLabel } from './ownerUtils';

interface OwnerSelectProps {
    groupId?: number;
    value: number | null | undefined;
    onChange: (userId: number | null) => void;
    disabled?: boolean;
    id?: string;
    ariaLabel?: string;
    className?: string;
    menuContainer?: HTMLElement | null;
    fallbackLabel?: string | null;
    fallbackUsername?: string | null;
    fallbackStatus?: OwnerStatus | null;
    excludeUserIds?: number[];
    placeholder?: string;
}

function buildOwnerOptions(params: {
    candidatesData?: GroupOwnerOption[];
    value: number | null | undefined;
    excludeUserIds?: number[];
    fallbackLabel?: string | null;
    fallbackUsername?: string | null;
    fallbackStatus?: OwnerStatus | null;
}) {
    const { candidatesData, value, excludeUserIds, fallbackLabel, fallbackUsername, fallbackStatus } = params;
    const excludedSet = excludeUserIds && excludeUserIds.length > 0 ? new Set(excludeUserIds) : null;
    const candidates = (candidatesData ?? [])
        .filter((item) => !excludedSet?.has(item.userId))
        .map((item) => ({
            value: String(item.userId),
            label: formatCandidateLabel(item.displayName, item.username),
        }));

    if (value != null && !candidates.some((opt) => opt.value === String(value))) {
        const baseLabel = formatCandidateLabel(fallbackLabel, fallbackUsername);
        const suffix = fallbackStatus === 'DISABLED'
            ? '（已停用）'
            : fallbackStatus === 'LEFT_GROUP'
                ? '（已离组）'
                : '';
        candidates.unshift({
            value: String(value),
            label: `${baseLabel === '--' ? `用户 #${value}` : baseLabel}${suffix}`,
        });
    }

    return candidates;
}

function OwnerSelectControl({
    groupId,
    value,
    onChange,
    disabled = false,
    id,
    ariaLabel = '负责人',
    className,
    menuContainer,
    fallbackLabel,
    fallbackUsername,
    fallbackStatus,
    excludeUserIds,
    placeholder = '请选择负责人',
    candidatesData,
    isLoading,
}: OwnerSelectProps & { candidatesData?: GroupOwnerOption[]; isLoading: boolean }) {
    const options = useMemo(
        () => buildOwnerOptions({
            candidatesData,
            value,
            excludeUserIds,
            fallbackLabel,
            fallbackUsername,
            fallbackStatus,
        }),
        [candidatesData, excludeUserIds, fallbackLabel, fallbackStatus, fallbackUsername, value],
    );

    return (
        <SimpleSelect
            id={id}
            ariaLabel={ariaLabel}
            className={className}
            value={value != null ? String(value) : ''}
            placeholder={isLoading ? '加载成员中...' : placeholder}
            disabled={disabled || groupId == null}
            menuContainer={menuContainer}
            options={options}
            onChange={(nextValue) => {
                const parsed = Number(nextValue);
                onChange(Number.isFinite(parsed) && parsed > 0 ? parsed : null);
            }}
        />
    );
}

function OwnerSelectWithQuery(props: OwnerSelectProps) {
    const query = useQuery({
        queryKey: ['group-owners', props.groupId],
        queryFn: () => Promise.resolve(getGroupOwnerCandidates?.(props.groupId!)).then((res) => res ?? []),
        enabled: props.groupId != null,
        staleTime: 60_000,
    });

    return (
        <OwnerSelectControl
            {...props}
            candidatesData={query.data}
            isLoading={query.isLoading}
        />
    );
}

function OwnerSelectWithoutQuery(props: OwnerSelectProps) {
    const [candidatesData, setCandidatesData] = useState<GroupOwnerOption[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        if (props.groupId == null) {
            setCandidatesData([]);
            setIsLoading(false);
            return;
        }
        let active = true;
        setIsLoading(true);
        Promise.resolve(getGroupOwnerCandidates?.(props.groupId))
            .then((res) => {
                if (active) setCandidatesData(res ?? []);
            })
            .catch(() => {
                if (active) setCandidatesData([]);
            })
            .finally(() => {
                if (active) setIsLoading(false);
            });
        return () => {
            active = false;
        };
    }, [props.groupId]);

    return (
        <OwnerSelectControl
            {...props}
            candidatesData={candidatesData}
            isLoading={isLoading}
        />
    );
}

export function OwnerSelect(props: OwnerSelectProps) {
    const queryClient = useContext(QueryClientContext);
    return queryClient ? <OwnerSelectWithQuery {...props} /> : <OwnerSelectWithoutQuery {...props} />;
}
