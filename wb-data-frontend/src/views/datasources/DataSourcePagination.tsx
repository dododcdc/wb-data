import { ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight } from 'lucide-react';
import { SimpleSelect } from '../../components/SimpleSelect';
import { PAGE_SIZE_OPTIONS } from './config';

interface DataSourcePaginationProps {
    total: number;
    currentPage: number;
    pageSize: number;
    isFetching: boolean;
    hoverLocked: boolean;
    onPageChange: (page: number) => void;
    onPageSizeChange: (pageSize: number) => void;
}

export function DataSourcePagination(props: DataSourcePaginationProps) {
    const {
        total,
        currentPage,
        pageSize,
        isFetching,
        hoverLocked,
        onPageChange,
        onPageSizeChange,
    } = props;

    const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1);
    const prevDisabled = currentPage === 1 || isFetching;
    const nextDisabled = currentPage >= totalPages || isFetching;
    const pageStart = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
    const pageEnd = total === 0 ? 0 : Math.min(currentPage * pageSize, total);
    const pageCount = total === 0 ? 0 : pageEnd - pageStart + 1;
    const pageSizeOptions = PAGE_SIZE_OPTIONS.map((value) => ({
        label: `${value} 条`,
        value: String(value),
    }));

    const goToPage = (page: number) => {
        if (page < 1 || page > totalPages || page === currentPage || isFetching) {
            return;
        }
        onPageChange(page);
    };

    if (total === 0) return null;

    return (
        <div className={`datasource-pagination datasource-pagination-admin ${hoverLocked ? 'hover-locked' : ''}`}>
            <div className="datasource-page-info">
                本页 {pageCount} 条，共 {total} 条
            </div>

            <div className="datasource-pagination-controls" aria-label="数据源分页导航">
                <div className="datasource-page-size-group">
                    <span className="datasource-pagination-label">每页</span>
                    <div className="datasource-page-size-select">
                        <SimpleSelect
                            id="datasource-page-size"
                            value={String(pageSize)}
                            options={pageSizeOptions}
                            disabled={isFetching}
                            menuPlacement="up"
                            onChange={(value) => {
                                const parsed = Number(value);
                                if (Number.isFinite(parsed) && parsed !== pageSize) {
                                    onPageSizeChange(parsed);
                                }
                            }}
                        />
                    </div>
                </div>

                <div className="datasource-page-status">
                    第 {currentPage} / {totalPages} 页
                </div>

                <div className="datasource-page-actions">
                    <button
                        className="datasource-page-icon-btn"
                        type="button"
                        aria-label="第一页"
                        aria-disabled={prevDisabled}
                        disabled={prevDisabled}
                        onClick={() => goToPage(1)}
                    >
                        <ChevronsLeft size={16} />
                    </button>
                    <button
                        className="datasource-page-icon-btn"
                        type="button"
                        aria-label="上一页"
                        aria-disabled={prevDisabled}
                        disabled={prevDisabled}
                        onClick={() => goToPage(currentPage - 1)}
                    >
                        <ChevronLeft size={16} />
                    </button>
                    <button
                        className="datasource-page-icon-btn"
                        type="button"
                        aria-label="下一页"
                        aria-disabled={nextDisabled}
                        disabled={nextDisabled}
                        onClick={() => goToPage(currentPage + 1)}
                    >
                        <ChevronRight size={16} />
                    </button>
                    <button
                        className="datasource-page-icon-btn"
                        type="button"
                        aria-label="最后一页"
                        aria-disabled={nextDisabled}
                        disabled={nextDisabled}
                        onClick={() => goToPage(totalPages)}
                    >
                        <ChevronsRight size={16} />
                    </button>
                </div>
            </div>
        </div>
    );
}
