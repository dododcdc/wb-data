import '../core/RouteSkeletons.css';

export default function DashboardSkeleton() {
    return (
        <div className="route-skeleton-shell">
            <div className="route-skeleton-dashboard" aria-hidden="true">
                <div className="route-skeleton-dashboard-hero">
                    <div className="route-skeleton-block route-skeleton-dashboard-icon" />
                    <div className="route-skeleton-block route-skeleton-dashboard-title" />
                    <div className="route-skeleton-block route-skeleton-dashboard-subtitle" />
                    <div className="route-skeleton-block route-skeleton-dashboard-subtitle short" />
                </div>

                <div className="route-skeleton-dashboard-cards">
                    {Array.from({ length: 2 }, (_, index) => (
                        <div className="route-skeleton-card route-skeleton-dashboard-card" key={index}>
                            <div className="route-skeleton-block route-skeleton-dashboard-card-icon" />
                            <div className="route-skeleton-dashboard-card-copy">
                                <div className="route-skeleton-block route-skeleton-dashboard-card-title" />
                                <div className="route-skeleton-block route-skeleton-dashboard-card-text" />
                            </div>
                            <div className="route-skeleton-block route-skeleton-dashboard-card-arrow" />
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
