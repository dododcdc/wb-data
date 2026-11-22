import { useEffect, useMemo, type CSSProperties } from 'react';
import { preloadHighlighter, type ThemesType } from '@pierre/diffs';
import {
    File as PierreFile,
    FileDiff,
    type FileDiffOptions,
    type FileOptions,
} from '@pierre/diffs/react';
import type { PierreDiffModel } from './pierreDiffModel';

const DIFF_THEMES: ThemesType = {
    light: 'pierre-light',
    dark: 'pierre-dark',
};

const DIFF_HOST_STYLE = {
    '--diffs-font-family': 'var(--font-mono)',
    '--diffs-header-font-family': 'var(--font-sans)',
    '--diffs-font-size': '13px',
    '--diffs-line-height': '21px',
    '--diffs-light-bg': '#F8F7F4',
    '--diffs-dark-bg': '#1A1816',
    '--diffs-light-addition-color': '#1A7A42',
    '--diffs-light-deletion-color': '#B42318',
    '--diffs-light-modified-color': '#B8860B',
    '--diffs-dark-addition-color': '#6EE7A0',
    '--diffs-dark-deletion-color': '#FCA5A5',
    '--diffs-dark-modified-color': '#FCD34D',
} as CSSProperties;

let preloadedThemes = false;

interface PierreCodeDiffProps {
    model: PierreDiffModel;
    diffStyle: 'split' | 'unified';
    expandUnchanged: boolean;
    overflow: 'wrap' | 'scroll';
    isDark: boolean;
    onShowWhitespaceDiff?: () => void;
    compact?: boolean;
}

export function PierreCodeDiff({
    model,
    diffStyle,
    expandUnchanged,
    overflow,
    isDark,
    onShowWhitespaceDiff,
    compact = false,
}: PierreCodeDiffProps) {
    useEffect(() => {
        if (preloadedThemes || typeof window === 'undefined') return;
        preloadedThemes = true;
        void preloadHighlighter({
            themes: ['pierre-light', 'pierre-dark'],
            langs: ['sql', 'zsh', 'json'],
        }).catch(() => {
            preloadedThemes = false;
        });
    }, []);

    const themeType = isDark ? 'dark' : 'light';

    const diffOptions = useMemo<FileDiffOptions<undefined, undefined>>(() => ({
        theme: DIFF_THEMES,
        themeType,
        diffStyle,
        diffIndicators: 'classic',
        hunkSeparators: 'line-info',
        lineDiffType: 'word-alt',
        expandUnchanged,
        overflow,
        disableFileHeader: true,
    }), [diffStyle, expandUnchanged, overflow, themeType]);

    const fileOptions = useMemo<FileOptions<undefined, undefined>>(() => ({
        theme: DIFF_THEMES,
        themeType,
        overflow,
        disableFileHeader: true,
    }), [overflow, themeType]);

    if (model.kind === 'empty') {
        return (
            <div className="pierre-diff-empty">
                暂无脚本或配置文本内容
            </div>
        );
    }

    if (model.kind === 'diff') {
        return (
            <div className={`pierre-code-diff-surface ${compact ? 'is-compact' : ''}`}>
                <FileDiff
                    fileDiff={model.fileDiff}
                    options={diffOptions}
                    style={DIFF_HOST_STYLE}
                    disableWorkerPool
                />
            </div>
        );
    }

    const bannerText = model.kind === 'whitespace-only'
        ? '仅存在首尾空白或缩进变化'
        : '脚本内容与基准版本一致（仅上游依赖或属性变更）';

    return (
        <div className="pierre-diff-unchanged-wrap">
            <div className="pierre-diff-notice-bar" role="status">
                <span>{bannerText}</span>
                {model.kind === 'whitespace-only' && onShowWhitespaceDiff ? (
                    <button
                        type="button"
                        className="pierre-diff-inline-action"
                        onClick={onShowWhitespaceDiff}
                    >
                        显示空白差异
                    </button>
                ) : null}
            </div>
            <div className={`pierre-code-diff-surface ${compact ? 'is-compact' : ''}`}>
                <PierreFile
                    file={model.previewFile}
                    options={fileOptions}
                    style={DIFF_HOST_STYLE}
                    disableWorkerPool
                />
            </div>
        </div>
    );
}
