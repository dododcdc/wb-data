export function formatOwnerDisplay(
    name?: string | null,
    username?: string | null,
    fallback?: string | null,
) {
    return name?.trim() || username?.trim() || fallback?.trim() || '--';
}

export function formatCandidateLabel(displayName?: string | null, username?: string | null) {
    const trimmedName = displayName?.trim();
    const trimmedUser = username?.trim();
    if (trimmedName && trimmedUser && trimmedName !== trimmedUser) {
        return `${trimmedName} (@${trimmedUser})`;
    }
    return trimmedName || trimmedUser || '--';
}
