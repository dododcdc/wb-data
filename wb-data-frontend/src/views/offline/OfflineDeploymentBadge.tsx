import { useEffect, useState } from 'react';
import { CircleAlert, Cloud, LoaderCircle } from 'lucide-react';

import { getGitSyncConfigs, type GitSyncConfig } from '../../api/gitSettings';
import { resolveDeploymentStatus } from './deploymentStatus';

export function OfflineDeploymentBadge({ groupId, branch }: { groupId: number | null; branch: string | null }) {
    const [config, setConfig] = useState<GitSyncConfig | null>(null);

    useEffect(() => {
        if (groupId == null || branch == null) {
            setConfig(null);
            return;
        }
        let cancelled = false;
        const load = () => {
            void getGitSyncConfigs(groupId)
                .then((response) => {
                    if (!cancelled) {
                        setConfig(response.configs.find((item) => item.branch === branch) ?? null);
                    }
                })
                .catch(() => {
                    if (!cancelled) setConfig(null);
                });
        };
        setConfig(null);
        load();
        const timer = window.setInterval(load, 30_000);
        return () => {
            cancelled = true;
            window.clearInterval(timer);
        };
    }, [groupId, branch]);

    const status = resolveDeploymentStatus(config);
    if (!status) return null;

    return (
        <span className={`offline-deployment-badge is-${status.tone}`} title={status.detail} role="status">
            {status.tone === 'pending' ? <LoaderCircle size={13} className="offline-spin" aria-hidden="true" /> : null}
            {status.tone === 'confirmed' ? <Cloud size={13} aria-hidden="true" /> : null}
            {status.tone === 'unknown' ? <CircleAlert size={13} aria-hidden="true" /> : null}
            <span>{status.label}</span>
        </span>
    );
}
