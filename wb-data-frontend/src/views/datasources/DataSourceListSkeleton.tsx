import '../DataSourceList.css';

const SKELETON_ROWS = 6;

export default function DataSourceListSkeleton() {
    return (
        <div className="datasource-page datasource-page-skeleton" aria-hidden="true">
            <section className="datasource-toolbar datasource-skeleton-toolbar">
                <div className="datasource-skeleton-block datasource-skeleton-search" />
                <div className="datasource-skeleton-block datasource-skeleton-button" />
            </section>

            <section className="datasource-table-panel datasource-skeleton-panel">
                <div className="datasource-skeleton-progress" />
                <div className="datasource-skeleton-head">
                    <div className="datasource-skeleton-block datasource-skeleton-heading" />
                    <div className="datasource-skeleton-block datasource-skeleton-heading short" />
                </div>
                <div className="datasource-skeleton-table">
                    {Array.from({ length: SKELETON_ROWS }, (_, index) => (
                        <div className="datasource-skeleton-row" key={index}>
                            <div className="datasource-skeleton-cell wide">
                                <div className="datasource-skeleton-block datasource-skeleton-line long" />
                                <div className="datasource-skeleton-block datasource-skeleton-line short" />
                            </div>
                            <div className="datasource-skeleton-cell">
                                <div className="datasource-skeleton-block datasource-skeleton-chip" />
                            </div>
                            <div className="datasource-skeleton-cell">
                                <div className="datasource-skeleton-block datasource-skeleton-line medium" />
                            </div>
                            <div className="datasource-skeleton-cell">
                                <div className="datasource-skeleton-block datasource-skeleton-pill" />
                            </div>
                            <div className="datasource-skeleton-cell">
                                <div className="datasource-skeleton-block datasource-skeleton-line short" />
                            </div>
                            <div className="datasource-skeleton-cell">
                                <div className="datasource-skeleton-block datasource-skeleton-line medium" />
                            </div>
                            <div className="datasource-skeleton-cell actions">
                                <div className="datasource-skeleton-block datasource-skeleton-icon" />
                                <div className="datasource-skeleton-block datasource-skeleton-icon" />
                                <div className="datasource-skeleton-block datasource-skeleton-icon" />
                            </div>
                        </div>
                    ))}
                </div>
                <div className="datasource-skeleton-pagination-row">
                    <div className="datasource-skeleton-block datasource-skeleton-total" />
                    <div className="datasource-skeleton-pagination-actions">
                        <div className="datasource-skeleton-block datasource-skeleton-page" />
                        <div className="datasource-skeleton-block datasource-skeleton-page" />
                        <div className="datasource-skeleton-block datasource-skeleton-page active" />
                        <div className="datasource-skeleton-block datasource-skeleton-page" />
                    </div>
                </div>
            </section>
        </div>
    );
}
