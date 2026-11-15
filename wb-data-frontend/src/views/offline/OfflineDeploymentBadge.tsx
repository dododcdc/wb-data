import { useEffect, useState } from 'react';
import { CircleAlert, Cloud, LoaderCircle } from 'lucide-react';

import { getGitSyncConfigs, type GitSyncConfig } from '../../api/gitSettings';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip';
import { resolveDeploymentStatus } from './deploymentStatus';

export function OfflineDeploymentBadge({
    groupId,
    branch,
    config: providedConfig,
}: {
    groupId: number | null;
    branch: string | null;
    config?: GitSyncConfig | null;
}) {
    const [polledConfig, setPolledConfig] = useState<GitSyncConfig | null>(null);
    const hasProvidedConfig = providedConfig !== undefined;

    useEffect(() => {
        if (hasProvidedConfig) {
            setPolledConfig(null);
            return;
        }
        if (groupId == null || branch == null) {
            setPolledConfig(null);
            return;
        }
        let cancelled = false;
        const load = () => {
            void getGitSyncConfigs(groupId)
                .then((response) => {
                    if (!cancelled) {
                        setPolledConfig(response.configs.find((item) => item.branch === branch) ?? null);
                    }
                })
                .catch(() => {
                    if (!cancelled) setPolledConfig(null);
                });
        };
        setPolledConfig(null);
        load();
        const timer = window.setInterval(load, 30_000);
        return () => {
            cancelled = true;
            window.clearInterval(timer);
        };
    }, [branch, groupId, hasProvidedConfig]);

    const config = hasProvidedConfig ? providedConfig : polledConfig;

    const status = resolveDeploymentStatus(config);
    if (!status) return null;

    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <span className={`offline-deployment-badge is-${status.tone}`} role="status">
                    {status.tone === 'pending' ? <LoaderCircle size={13} className="offline-spin" aria-hidden="true" /> : null}
                    {status.tone === 'confirmed' ? <Cloud size={13} aria-hidden="true" /> : null}
                    {status.tone === 'unknown' ? <CircleAlert size={13} aria-hidden="true" /> : null}
                    <span>{status.label}</span>
                </span>
            </TooltipTrigger>
            <TooltipContent className="tooltip-content tooltip-content-wrap" side="bottom" align="end" collisionPadding={12}>
                {status.detail}
            </TooltipContent>
        </Tooltip>
    );
}
