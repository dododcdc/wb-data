import { groupScopedPath } from '../groupScoped';

// Backend GitRepositoryOperations allows 30s per remote git CLI command, and push/rebuild
// may chain fetch/ls-remote + push + Kestra sync trigger.
export const REMOTE_GIT_REQUEST_TIMEOUT_MS = 90_000;

export function offlinePath(groupId: number, path: string) {
    return groupScopedPath(groupId, `/offline${path}`);
}
