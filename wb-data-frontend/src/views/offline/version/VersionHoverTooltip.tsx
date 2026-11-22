import { useEffect, useState, type ReactElement } from 'react';

import { Tooltip, TooltipContent, TooltipTrigger } from '../../../components/ui/tooltip';
import {
    getVersionTooltipDetails,
    type VersionMetadataLike,
} from './versionComparePresentation';

interface VersionHoverTooltipProps {
    version: VersionMetadataLike;
    children: ReactElement;
    side?: 'top' | 'bottom' | 'left' | 'right';
    disabled?: boolean;
}

/** Displays commit message, author, timestamp, and online status only on hover/focus. */
export function VersionHoverTooltip({
    version,
    children,
    side = 'bottom',
    disabled = false,
}: VersionHoverTooltipProps) {
    const [open, setOpen] = useState(false);
    const { primary, secondary } = getVersionTooltipDetails(version);
    const hasContent = Boolean(primary || secondary);
    const effectiveOpen = !disabled && hasContent && open;

    useEffect(() => {
        if (disabled || !hasContent) {
            setOpen(false);
        }
    }, [disabled, hasContent]);

    return (
        <Tooltip
            open={effectiveOpen}
            onOpenChange={(nextOpen) => {
                if (disabled || !hasContent) {
                    setOpen(false);
                    return;
                }
                setOpen(nextOpen);
            }}
        >
            {/* Keep TooltipTrigger mounted so disabling tooltips never remounts anchored popovers */}
            <TooltipTrigger asChild>{children}</TooltipTrigger>
            {hasContent && !disabled ? (
                <TooltipContent
                    side={side}
                    className="z-[2200] max-w-80 space-y-1 px-3 py-2 text-xs shadow-lg"
                >
                    {primary ? (
                        <div className="font-medium leading-snug text-popover-foreground break-words">
                            {primary}
                        </div>
                    ) : null}
                    {secondary ? (
                        <div className="text-[11px] leading-tight text-muted-foreground tabular-nums">
                            {secondary}
                        </div>
                    ) : null}
                </TooltipContent>
            ) : null}
        </Tooltip>
    );
}
