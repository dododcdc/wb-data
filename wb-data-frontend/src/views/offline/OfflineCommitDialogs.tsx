import { LoaderCircle } from 'lucide-react';
import { Button } from '../../components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '../../components/ui/dialog';

export type CommitMode = 'save-and-commit' | 'saved-only';

export interface OfflineCommitDialogsProps {
    flowCommitOpen: boolean;
    repoCommitOpen: boolean;
    commitMessage: string;
    committing: boolean;
    flowDraftDirty: boolean;
    flowCommitDirty: boolean;
    repoDraftDirty: boolean;
    repoDirty: boolean;
    onFlowCommitOpenChange: (open: boolean) => void;
    onRepoCommitOpenChange: (open: boolean) => void;
    onCommitMessageChange: (message: string) => void;
    onCommitFlow: (mode: CommitMode) => void;
    onCommitRepo: (mode: CommitMode) => void;
}

interface CommitDialogShellProps {
    open: boolean;
    title: string;
    description: string;
    commitMessage: string;
    committing: boolean;
    draftDirty: boolean;
    savedDirty: boolean;
    onOpenChange: (open: boolean) => void;
    onCommitMessageChange: (message: string) => void;
    onCommit: (mode: CommitMode) => void;
}

function CommitDialogShell(props: CommitDialogShellProps) {
    const {
        open,
        title,
        description,
        commitMessage,
        committing,
        draftDirty,
        savedDirty,
        onOpenChange,
        onCommitMessageChange,
        onCommit,
    } = props;
    const canCommit = !!commitMessage.trim() && !committing;
    const showSavedOnlyAction = draftDirty && savedDirty;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent style={{ maxWidth: '500px' }}>
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription className="sr-only">
                        {description}
                    </DialogDescription>
                </DialogHeader>
                <div className="dialog-body">
                    <label style={{ display: 'block', marginBottom: 6, fontSize: '0.84rem', color: 'var(--color-text-secondary)' }}>
                        提交说明
                    </label>
                    <textarea
                        value={commitMessage}
                        onChange={(event) => onCommitMessageChange(event.target.value)}
                        placeholder={'简要描述本次修改\n\n详细说明修改原因和影响（可选）'}
                        autoFocus
                        rows={4}
                        className="offline-commit-textarea"
                    />
                </div>
                <DialogFooter>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => onOpenChange(false)}
                        disabled={committing}
                    >
                        取消
                    </Button>
                    {showSavedOnlyAction && (
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => onCommit('saved-only')}
                            disabled={!canCommit}
                        >
                            {committing ? <LoaderCircle size={14} className="offline-spin" /> : null}
                            仅提交已保存内容
                        </Button>
                    )}
                    <Button
                        type="button"
                        variant="default"
                        size="sm"
                        onClick={() => onCommit(draftDirty ? 'save-and-commit' : 'saved-only')}
                        disabled={!canCommit}
                    >
                        {committing ? <LoaderCircle size={14} className="offline-spin" /> : null}
                        {committing ? '提交中…' : draftDirty ? '保存并提交' : '提交'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

export function OfflineCommitDialogs(props: OfflineCommitDialogsProps) {
    const {
        flowCommitOpen,
        repoCommitOpen,
        commitMessage,
        committing,
        flowDraftDirty,
        flowCommitDirty,
        repoDraftDirty,
        repoDirty,
        onFlowCommitOpenChange,
        onRepoCommitOpenChange,
        onCommitMessageChange,
        onCommitFlow,
        onCommitRepo,
    } = props;

    return (
        <>
            <CommitDialogShell
                open={flowCommitOpen}
                title="提交改动"
                description="提交当前 Flow 的已保存内容，或先保存当前草稿再提交。"
                commitMessage={commitMessage}
                committing={committing}
                draftDirty={flowDraftDirty}
                savedDirty={flowCommitDirty}
                onOpenChange={onFlowCommitOpenChange}
                onCommitMessageChange={onCommitMessageChange}
                onCommit={onCommitFlow}
            />
            <CommitDialogShell
                open={repoCommitOpen}
                title="提交仓库"
                description="提交当前项目组离线仓库中的已保存改动，或先保存当前草稿再提交。"
                commitMessage={commitMessage}
                committing={committing}
                draftDirty={repoDraftDirty}
                savedDirty={repoDirty}
                onOpenChange={onRepoCommitOpenChange}
                onCommitMessageChange={onCommitMessageChange}
                onCommit={onCommitRepo}
            />
        </>
    );
}
