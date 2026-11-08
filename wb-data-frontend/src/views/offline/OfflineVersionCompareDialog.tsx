import { useEffect, useMemo, useState } from 'react';
import { DiffEditor } from '@monaco-editor/react';
import { CircleAlert } from 'lucide-react';

import {
    getOfflineFlowSnapshot,
    getOfflineFlowSnapshotFile,
    type OfflineFlowVersionSnapshot,
} from '../../api/offline';
import { Button } from '../../components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '../../components/ui/dialog';
import './OfflineVersionCompareDialog.css';

export interface VersionSelection {
    revision: string;
    label: string;
}

interface OfflineVersionCompareDialogProps {
    groupId: number;
    path: string;
    base: VersionSelection;
    target: VersionSelection;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

interface ComparedFile {
    path: string;
    kind: 'added' | 'removed' | 'changed' | 'unchanged';
}

export function OfflineVersionCompareDialog({ groupId, path, base, target, open, onOpenChange }: OfflineVersionCompareDialogProps) {
    const [baseSnapshot, setBaseSnapshot] = useState<OfflineFlowVersionSnapshot | null>(null);
    const [targetSnapshot, setTargetSnapshot] = useState<OfflineFlowVersionSnapshot | null>(null);
    const [selectedPath, setSelectedPath] = useState<string | null>(null);
    const [original, setOriginal] = useState('');
    const [modified, setModified] = useState('');
    const [showAll, setShowAll] = useState(false);
    const [loading, setLoading] = useState(false);
    const [fileLoading, setFileLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        setLoading(true);
        setError(null);
        setBaseSnapshot(null);
        setTargetSnapshot(null);
        void Promise.all([
            getOfflineFlowSnapshot(groupId, path, base.revision),
            getOfflineFlowSnapshot(groupId, path, target.revision),
        ]).then(([baseResponse, targetResponse]) => {
            if (!cancelled) {
                setBaseSnapshot(baseResponse);
                setTargetSnapshot(targetResponse);
            }
        }).catch(() => {
            if (!cancelled) setError('版本快照读取失败，请重试');
        }).finally(() => {
            if (!cancelled) setLoading(false);
        });
        return () => { cancelled = true; };
    }, [base.revision, groupId, open, path, target.revision]);

    const files = useMemo(() => {
        if (!baseSnapshot || !targetSnapshot) return [];
        const paths = new Set([
            ...baseSnapshot.files.map((file) => file.path),
            ...targetSnapshot.files.map((file) => file.path),
        ]);
        const baseByPath = new Map(baseSnapshot.files.map((file) => [file.path, file.sha256]));
        const targetByPath = new Map(targetSnapshot.files.map((file) => [file.path, file.sha256]));
        const compared = [...paths].sort().map((filePath): ComparedFile => {
            const baseHash = baseByPath.get(filePath);
            const targetHash = targetByPath.get(filePath);
            if (!baseHash) return { path: filePath, kind: 'added' };
            if (!targetHash) return { path: filePath, kind: 'removed' };
            return { path: filePath, kind: baseHash === targetHash ? 'unchanged' : 'changed' };
        });
        return showAll ? compared : compared.filter((file) => file.kind !== 'unchanged');
    }, [baseSnapshot, showAll, targetSnapshot]);

    useEffect(() => {
        if (!files.some((file) => file.path === selectedPath)) {
            setSelectedPath(files[0]?.path ?? null);
        }
    }, [files, selectedPath]);

    useEffect(() => {
        if (!selectedPath || !baseSnapshot || !targetSnapshot) {
            setOriginal('');
            setModified('');
            return;
        }
        let cancelled = false;
        const baseHas = baseSnapshot.files.some((file) => file.path === selectedPath);
        const targetHas = targetSnapshot.files.some((file) => file.path === selectedPath);
        setFileLoading(true);
        void Promise.all([
            baseHas ? getOfflineFlowSnapshotFile(groupId, path, base.revision, selectedPath) : Promise.resolve(null),
            targetHas ? getOfflineFlowSnapshotFile(groupId, path, target.revision, selectedPath) : Promise.resolve(null),
        ]).then(([baseFile, targetFile]) => {
            if (!cancelled) {
                setOriginal(baseFile?.content ?? '');
                setModified(targetFile?.content ?? '');
            }
        }).catch(() => {
            if (!cancelled) setError('原始文件读取失败，请选择其他文件重试');
        }).finally(() => {
            if (!cancelled) setFileLoading(false);
        });
        return () => { cancelled = true; };
    }, [base.revision, baseSnapshot, groupId, path, selectedPath, target.revision, targetSnapshot]);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent fullScreen className="offline-version-compare-dialog">
                <DialogHeader>
                    <DialogTitle>原始文件对比</DialogTitle>
                    <DialogDescription>{base.label} → {target.label}</DialogDescription>
                </DialogHeader>
                <div className="offline-version-compare-toolbar">
                    <label>
                        <input type="checkbox" checked={showAll} onChange={(event) => setShowAll(event.target.checked)} />
                        显示全部文件
                    </label>
                </div>
                {error ? (
                    <div className="offline-version-compare-error" role="alert">
                        <CircleAlert size={16} />{error}
                        <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>关闭</Button>
                    </div>
                ) : null}
                <div className="offline-version-compare-body">
                    <aside className="offline-version-file-list">
                        {loading ? <div className="offline-version-file-skeleton" aria-hidden="true" /> : null}
                        {!loading && !error && files.length === 0 ? <p>没有文件差异</p> : null}
                        {files.map((file) => (
                            <button
                                type="button"
                                key={file.path}
                                className={file.path === selectedPath ? 'is-active' : ''}
                                onClick={() => setSelectedPath(file.path)}
                            >
                                <span>{file.path}</span>
                                <small>{labelFor(file.kind)}</small>
                            </button>
                        ))}
                    </aside>
                    <section className="offline-version-diff-editor">
                        {selectedPath && !fileLoading ? (
                            <DiffEditor
                                key={`${base.revision}:${target.revision}:${selectedPath}`}
                                original={original}
                                modified={modified}
                                language={languageFor(selectedPath)}
                                originalModelPath={`${base.revision}/${selectedPath}`}
                                modifiedModelPath={`${target.revision}/${selectedPath}`}
                                options={{
                                    readOnly: true,
                                    originalEditable: false,
                                    renderSideBySide: true,
                                    wordWrap: 'on',
                                    scrollBeyondLastLine: false,
                                }}
                            />
                        ) : (
                            <div className="offline-version-editor-skeleton" aria-hidden="true" />
                        )}
                    </section>
                </div>
            </DialogContent>
        </Dialog>
    );
}

function labelFor(kind: ComparedFile['kind']) {
    switch (kind) {
        case 'added': return '新增';
        case 'removed': return '删除';
        case 'changed': return '修改';
        default: return '未变';
    }
}

function languageFor(path: string) {
    if (path.endsWith('.sql')) return 'sql';
    if (path.endsWith('.sh')) return 'shell';
    if (path.endsWith('.json')) return 'json';
    return 'yaml';
}
