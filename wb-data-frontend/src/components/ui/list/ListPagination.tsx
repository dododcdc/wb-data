import { useId } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { SimpleSelect } from '../../SimpleSelect';
import { PAGE_SIZE_OPTIONS } from '../../../utils/pagination';
import { Button } from '../button';

interface ListPaginationProps {
    total: number;
    currentPage: number;
    pageSize: number;
    isFetching: boolean;
    onPageChange: (page: number) => void;
    onPageSizeChange: (pageSize: number) => void;
    ariaLabel?: string;
    className?: string;
    pageSizeOptions?: number[];
    selectId?: string;
}

export function ListPagination({
    total,
    currentPage,
    pageSize,
    isFetching,
    onPageChange,
    onPageSizeChange,
    ariaLabel = '列表分页导航',
    className = '',
    pageSizeOptions = PAGE_SIZE_OPTIONS,
    selectId: providedSelectId,
}: ListPaginationProps) {
    const generatedSelectId = useId();
    const selectId = providedSelectId ?? generatedSelectId;
    const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1);
    const previousDisabled = currentPage <= 1 || isFetching;
    const nextDisabled = currentPage >= totalPages || isFetching;
    const pageStart = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
    const pageEnd = total === 0 ? 0 : Math.min(currentPage * pageSize, total);
    const pageCount = total === 0 ? 0 : pageEnd - pageStart + 1;

    if (total === 0) return null;

    const goToPage = (page: number) => {
        if (page < 1 || page > totalPages || page === currentPage || isFetching) return;
        onPageChange(page);
    };

    return (
        <div className={`wb-list-pagination${className ? ` ${className}` : ''}`}>
            <div className="wb-list-pagination-info">本页 {pageCount} 条，共 {total} 条</div>
            <div className="wb-list-pagination-controls" aria-label={ariaLabel}>
                <div className="wb-list-page-size">
                    <span>每页</span>
                    <SimpleSelect
                        id={selectId}
                        value={String(pageSize)}
                        options={pageSizeOptions.map((value) => ({ label: `${value} 条`, value: String(value) }))}
                        disabled={isFetching}
                        menuPlacement="up"
                        onChange={(value) => {
                            const parsed = Number(value);
                            if (Number.isFinite(parsed) && parsed !== pageSize) onPageSizeChange(parsed);
                        }}
                    />
                </div>
                <span className="wb-list-pagination-status">第 {currentPage} / {totalPages} 页</span>
                <div className="wb-list-pagination-pages">
                    <Button
                        variant="outline"
                        size="icon"
                        type="button"
                        aria-label="上一页"
                        disabled={previousDisabled}
                        onClick={() => goToPage(currentPage - 1)}
                    >
                        <ChevronLeft size={16} />
                    </Button>
                    <Button
                        variant="outline"
                        size="icon"
                        type="button"
                        aria-label="下一页"
                        disabled={nextDisabled}
                        onClick={() => goToPage(currentPage + 1)}
                    >
                        <ChevronRight size={16} />
                    </Button>
                </div>
            </div>
        </div>
    );
}
