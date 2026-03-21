import './RouteSkeletons.css';

export default function QuerySkeleton() {
    return (
        <div className="route-skeleton-query" aria-hidden="true">
            <div className="route-skeleton-query-toolbar">
                <div className="route-skeleton-query-toolbar-left">
                    <div className="route-skeleton-block route-skeleton-query-sidebar-toggle" />
                    <div className="route-skeleton-query-divider" />
                    <div className="route-skeleton-block route-skeleton-query-select" />
                    <div className="route-skeleton-block route-skeleton-query-select short" />
                </div>
                <div className="route-skeleton-query-toolbar-right">
                    <div className="route-skeleton-block route-skeleton-query-icon" />
                    <div className="route-skeleton-block route-skeleton-query-run" />
                </div>
            </div>

            <div className="route-skeleton-query-main">
                <div className="route-skeleton-query-editor">
                    <div className="route-skeleton-query-gutter" />
                    <div className="route-skeleton-query-editor-lines">
                        <div className="route-skeleton-block route-skeleton-query-line long" />
                        <div className="route-skeleton-block route-skeleton-query-line medium" />
                        <div className="route-skeleton-block route-skeleton-query-line short" />
                    </div>
                </div>

                <div className="route-skeleton-query-results">
                    <div className="route-skeleton-block route-skeleton-query-results-header" />
                    <div className="route-skeleton-card route-skeleton-query-results-card">
                        <div className="route-skeleton-query-results-empty">
                            <div className="route-skeleton-block route-skeleton-query-results-icon" />
                            <div className="route-skeleton-block route-skeleton-query-results-text" />
                            <div className="route-skeleton-block route-skeleton-query-results-text short" />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
