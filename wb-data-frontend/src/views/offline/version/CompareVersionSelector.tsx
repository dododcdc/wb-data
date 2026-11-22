import { useEffect, useMemo, useRef, useState } from 'react';
import { Popover as PopoverPrimitive } from '@base-ui/react/popover';
import { Check, ChevronDown, RotateCcw, Search, X } from 'lucide-react';
import type { OfflineFlowVersionItem } from '../../../api/offline';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../components/ui/tooltip';
import {
    buildCommitVersionSelection,
    buildWorktreeVersionSelection,
    formatRevisionTag,
    formatVersionShortLabel,
    formatVersionTime,
    formatVersionTooltipSummary,
    formatWorktreeDirtySummary,
    isDevelopmentVersion,
    type VersionSelection,
} from './versionComparePresentation';
import { VersionHoverTooltip } from './VersionHoverTooltip';

interface CompareVersionSelectorProps {
    roleLabel: '基准' | '对比';
    tone: 'base' | 'target';
    value: VersionSelection;
    peerValue: VersionSelection;
    items: OfflineFlowVersionItem[];
    onlineOnly: boolean;
    loading: boolean;
    loadingMore: boolean;
    error: string | null;
    hasMore: boolean;
    disabled?: boolean;
    portalContainer?: HTMLElement | null;
    onRequestOpen: () => void;
    onOpenChange?: (open: boolean) => void;
    onToggleOnlineOnly: (onlineOnly: boolean) => void;
    onLoadMore: () => void;
    onRetry: () => void;
    onSelect: (selection: VersionSelection) => void;
}

export function CompareVersionSelector({
    roleLabel,
    tone,
    value,
    peerValue,
    items,
    onlineOnly,
    loading,
    loadingMore,
    error,
    hasMore,
    disabled = false,
    portalContainer,
    onRequestOpen,
    onOpenChange,
    onToggleOnlineOnly,
    onLoadMore,
    onRetry,
    onSelect,
}: CompareVersionSelectorProps) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    const searchInputRef = useRef<HTMLInputElement | null>(null);

    const revTag = formatRevisionTag(value.revision);
    const shortLabel = formatVersionShortLabel(value);
    const isWorktree = isDevelopmentVersion(value);
    const showSeparateLabel = !isWorktree && shortLabel !== revTag;
    const tooltipSummary = formatVersionTooltipSummary(value);
    const peerBadgeLabel = tone === 'base' ? '当前对比' : '当前基准';
    const peerRoleName = tone === 'base' ? '对比版本' : '基准版本';

    const handleOpenChange = (nextOpen: boolean) => {
        setOpen(nextOpen);
        onOpenChange?.(nextOpen);
        if (nextOpen) {
            onRequestOpen();
        } else {
            setQuery('');
        }
    };

    useEffect(() => {
        if (!open) return;
        const raf = window.requestAnimationFrame(() => {
            searchInputRef.current?.focus();
        });
        return () => window.cancelAnimationFrame(raf);
    }, [open]);

    const options = useMemo(() => {
        const normalizedQuery = query.trim().toLowerCase();
        const mapped = items.map((item, index) => {
            const selection = item.kind === 'DEVELOPMENT'
                ? buildWorktreeVersionSelection(item)
                : buildCommitVersionSelection(item, index);
            return { item, selection };
        });
        if (!normalizedQuery) return mapped;

        return mapped.filter(({ item, selection }) => {
            const haystackParts = [
                selection.revision,
                formatRevisionTag(selection.revision),
                item.message ?? '',
                item.authorName ?? '',
                item.kind === 'DEVELOPMENT' ? '当前工作区 开发版本 工作区' : '',
                item.dirty ? '未提交修改' : '',
                ...item.publications.map((pub) => `v${pub.onlineVersion} 线上 v${pub.onlineVersion}${pub.currentOnline ? ' 当前线上' : ''}`),
            ];
            return haystackParts.join(' ').toLowerCase().includes(normalizedQuery);
        });
    }, [items, query]);

    return (
        <PopoverPrimitive.Root open={open} onOpenChange={handleOpenChange}>
            <VersionHoverTooltip version={value} disabled={open}>
                <PopoverPrimitive.Trigger
                    ref={triggerRef}
                    type="button"
                    disabled={disabled}
                    aria-label={
                        tooltipSummary
                            ? `选择${roleLabel}版本，当前 ${shortLabel}（${tooltipSummary}）`
                            : `选择${roleLabel}版本，当前 ${shortLabel}`
                    }
                    className={`offline-compare-version-chip is-${tone} is-interactive ${open ? 'is-open' : ''} ${tooltipSummary ? 'has-tooltip' : ''}`}
                >
                    <span className="offline-compare-chip-role">{roleLabel}</span>
                    {isWorktree ? (
                        <span className="offline-compare-chip-label">{shortLabel}</span>
                    ) : (
                        <>
                            {showSeparateLabel ? (
                                <span className="offline-compare-chip-label">{shortLabel}</span>
                            ) : null}
                            <code className="offline-compare-chip-rev">{revTag}</code>
                        </>
                    )}
                    {value.onlineVersion != null ? (
                        <span className="offline-compare-chip-online">
                            v{value.onlineVersion}{value.currentOnline ? ' 线上' : ''}
                        </span>
                    ) : null}
                    <ChevronDown size={13} className="offline-compare-chip-caret" aria-hidden="true" />
                </PopoverPrimitive.Trigger>
            </VersionHoverTooltip>

            <PopoverPrimitive.Portal container={portalContainer}>
                <PopoverPrimitive.Positioner
                    anchor={triggerRef}
                    side="bottom"
                    sideOffset={6}
                    align="start"
                    className="offline-version-picker-positioner pointer-events-auto isolate z-[2200]"
                >
                    <PopoverPrimitive.Popup
                        data-slot="select-content"
                        className="offline-version-picker-popover pointer-events-auto"
                    >
                        <div className="offline-version-picker-head">
                            <div className="offline-version-picker-search-wrap">
                                <Search size={13} className="offline-version-picker-search-icon" aria-hidden="true" />
                                <input
                                    ref={searchInputRef}
                                    type="text"
                                    value={query}
                                    onChange={(event) => setQuery(event.target.value)}
                                    placeholder="筛选版本号、说明或作者…"
                                    aria-label={`筛选${roleLabel}版本`}
                                    className="offline-version-picker-search"
                                />
                                {query ? (
                                    <button
                                        type="button"
                                        className="offline-version-picker-clear"
                                        aria-label="清空筛选"
                                        onClick={() => setQuery('')}
                                    >
                                        <X size={12} aria-hidden="true" />
                                    </button>
                                ) : null}
                            </div>
                            <div className="offline-version-picker-filter" role="group" aria-label="版本范围">
                                <button
                                    type="button"
                                    aria-pressed={!onlineOnly}
                                    className={`offline-version-filter-btn ${!onlineOnly ? 'is-active' : ''}`}
                                    onClick={() => onToggleOnlineOnly(false)}
                                >
                                    全部
                                </button>
                                <button
                                    type="button"
                                    aria-pressed={onlineOnly}
                                    className={`offline-version-filter-btn ${onlineOnly ? 'is-active' : ''}`}
                                    onClick={() => onToggleOnlineOnly(true)}
                                >
                                    仅线上
                                </button>
                            </div>
                        </div>

                        <div className="offline-version-picker-list" role="listbox" aria-label={`${roleLabel}可选版本`}>
                            {loading && items.length === 0 ? (
                                <div className="offline-version-picker-state">正在加载可选版本…</div>
                            ) : error && items.length === 0 ? (
                                <div className="offline-version-picker-state is-error">
                                    <span>{error}</span>
                                    <button
                                        type="button"
                                        className="offline-version-picker-retry"
                                        onClick={onRetry}
                                    >
                                        <RotateCcw size={12} aria-hidden="true" />
                                        重试
                                    </button>
                                </div>
                            ) : options.length === 0 ? (
                                <div className="offline-version-picker-state">
                                    {query.trim() ? '未匹配到符合条件的版本' : '暂无可选版本'}
                                </div>
                            ) : (
                                options.map(({ item, selection }, idx) => (
                                    <VersionPickerOptionRow
                                        key={`${item.kind}:${item.revision}`}
                                        item={item}
                                        selection={selection}
                                        isCurrent={selection.revision === value.revision}
                                        isPeer={selection.revision === peerValue.revision}
                                        hasTopDivider={idx > 0 && options[idx - 1].item.kind === 'DEVELOPMENT'}
                                        peerBadgeLabel={peerBadgeLabel}
                                        peerRoleName={peerRoleName}
                                        onSelect={() => {
                                            onSelect(selection);
                                            handleOpenChange(false);
                                        }}
                                    />
                                ))
                            )}
                        </div>

                        {hasMore ? (
                            <div className="offline-version-picker-foot">
                                <button
                                    type="button"
                                    className="offline-version-picker-more"
                                    disabled={loadingMore}
                                    onClick={onLoadMore}
                                >
                                    {loadingMore ? '正在加载更多…' : '加载更多历史版本'}
                                </button>
                            </div>
                        ) : null}
                    </PopoverPrimitive.Popup>
                </PopoverPrimitive.Positioner>
            </PopoverPrimitive.Portal>
        </PopoverPrimitive.Root>
    );
}

interface VersionPickerOptionRowProps {
    item: OfflineFlowVersionItem;
    selection: VersionSelection;
    isCurrent: boolean;
    isPeer: boolean;
    hasTopDivider: boolean;
    peerBadgeLabel: string;
    peerRoleName: string;
    onSelect: () => void;
}

function VersionPickerOptionRow({
    item,
    selection,
    isCurrent,
    isPeer,
    hasTopDivider,
    peerBadgeLabel,
    peerRoleName,
    onSelect,
}: VersionPickerOptionRowProps) {
    const msgRef = useRef<HTMLSpanElement | null>(null);
    const [tooltipOpen, setTooltipOpen] = useState(false);
    const [isTruncated, setIsTruncated] = useState(false);

    const isDev = item.kind === 'DEVELOPMENT';
    const optionRev = formatRevisionTag(selection.revision);
    const primaryDesc = isDev
        ? formatWorktreeDirtySummary(item.dirty)
        : (item.message || '未填写提交说明');
    const currentOnlinePub = item.publications.find((pub) => pub.currentOnline);
    const latestSuccessPub = currentOnlinePub
        ?? item.publications.find((pub) => pub.status === 'SUCCESS');

    const checkMessageTruncated = () => {
        const el = msgRef.current;
        return Boolean(el && el.scrollWidth > el.clientWidth);
    };

    const handleTooltipOpenChange = (nextOpen: boolean) => {
        if (!nextOpen) {
            setTooltipOpen(false);
            return;
        }
        const truncated = checkMessageTruncated();
        setIsTruncated(truncated);
        if (isPeer || truncated) {
            setTooltipOpen(true);
        }
    };

    return (
        <Tooltip
            disableHoverableContent
            open={tooltipOpen}
            onOpenChange={handleTooltipOpenChange}
        >
            <TooltipTrigger asChild>
                <span className={`offline-version-option-wrap ${isPeer ? 'is-peer' : ''} ${hasTopDivider ? 'has-top-divider' : ''}`}>
                    <button
                        type="button"
                        role="option"
                        aria-selected={isCurrent}
                        disabled={isPeer}
                        className={[
                            'offline-version-option',
                            isCurrent ? 'is-selected' : '',
                            isPeer ? 'is-peer' : '',
                            isDev ? 'is-dev' : '',
                        ].filter(Boolean).join(' ')}
                        onClick={() => {
                            if (isPeer) return;
                            onSelect();
                        }}
                    >
                        <div className="offline-version-option-top">
                            <div className="offline-version-option-id">
                                {isDev ? (
                                    <span className="offline-version-option-dev-name">当前工作区</span>
                                ) : (
                                    <code className="offline-version-option-rev">{optionRev}</code>
                                )}
                                {latestSuccessPub ? (
                                    <span className={`offline-version-option-online ${latestSuccessPub.currentOnline ? 'is-current' : ''}`}>
                                        {latestSuccessPub.currentOnline ? '当前线上 ' : '线上 '}
                                        v{latestSuccessPub.onlineVersion}
                                    </span>
                                ) : null}
                            </div>
                            <div className="offline-version-option-right">
                                {isPeer ? (
                                    <span className="offline-version-option-peer">{peerBadgeLabel}</span>
                                ) : null}
                                {!isDev && item.committedAt ? (
                                    <span className="offline-version-option-time">
                                        {formatVersionTime(item.committedAt)}
                                    </span>
                                ) : null}
                                {isCurrent ? (
                                    <Check size={13} className="offline-version-option-check" aria-hidden="true" />
                                ) : null}
                            </div>
                        </div>
                        <div className="offline-version-option-bottom">
                            <span ref={msgRef} className="offline-version-option-msg">{primaryDesc}</span>
                            {!isDev && item.authorName ? (
                                <span className="offline-version-option-author">{item.authorName}</span>
                            ) : null}
                        </div>
                    </button>
                </span>
            </TooltipTrigger>
            {isPeer || isTruncated ? (
                <TooltipContent
                    side="bottom"
                    align="center"
                    sideOffset={2}
                    collisionPadding={8}
                    className="offline-version-option-tooltip"
                >
                    {isPeer ? (
                        <div>
                            该版本正在作为{peerRoleName}，点击交换图标可对调
                        </div>
                    ) : null}
                    {isTruncated ? (
                        <div className={isPeer ? 'offline-version-option-tooltip-sub' : undefined}>
                            {primaryDesc}
                        </div>
                    ) : null}
                </TooltipContent>
            ) : null}
        </Tooltip>
    );
}
