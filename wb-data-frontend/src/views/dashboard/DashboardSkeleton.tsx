import '@/components/loading/RouteSkeletons.css';

export default function DashboardSkeleton() {
    return (
        <div className="route-skeleton-shell">
            <div className="route-skeleton-workspace" aria-hidden="true">
                <div className="route-skeleton-workspace-header">
                    <div className="route-skeleton-workspace-header-copy">
                        <div className="route-skeleton-block route-skeleton-workspace-title" />
                        <div className="route-skeleton-block route-skeleton-workspace-meta" />
                    </div>
                    <div className="route-skeleton-workspace-actions">
                        <div className="route-skeleton-block route-skeleton-workspace-btn" />
                        <div className="route-skeleton-block route-skeleton-workspace-btn" />
                    </div>
                </div>

                <div className="route-skeleton-workspace-strip">
                    {Array.from({ length: 4 }, (_, index) => (
                        <div className="route-skeleton-workspace-metric" key={index}>
                            <div className="route-skeleton-block route-skeleton-workspace-label" />
                            <div className="route-skeleton-block route-skeleton-workspace-value" />
                            <div className="route-skeleton-block route-skeleton-workspace-sub" />
                        </div>
                    ))}
                </div>

                <div className="route-skeleton-workspace-grid">
                    <div className="route-skeleton-workspace-panel">
                        <div className="route-skeleton-workspace-panel-head">
                            <div className="route-skeleton-block route-skeleton-workspace-label" />
                        </div>
                        {Array.from({ length: 5 }, (_, rowIndex) => (
                            <div className="route-skeleton-workspace-row" key={rowIndex}>
                                <div className="route-skeleton-block route-skeleton-workspace-row-main" />
                                <div className="route-skeleton-block route-skeleton-workspace-row-pill" />
                            </div>
                        ))}
                    </div>

                    <div className="route-skeleton-workspace-side">
                        <div className="route-skeleton-workspace-panel">
                            <div className="route-skeleton-workspace-panel-head">
                                <div className="route-skeleton-block route-skeleton-workspace-label" />
                            </div>
                            {Array.from({ length: 3 }, (_, rowIndex) => (
                                <div className="route-skeleton-workspace-row" key={rowIndex}>
                                    <div className="route-skeleton-block route-skeleton-workspace-row-main" />
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
