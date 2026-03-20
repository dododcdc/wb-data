import { useMemo } from 'react';
import {
    Pagination,
    PaginationContent,
    PaginationEllipsis,
    PaginationItem,
    PaginationLink,
} from '../../components/ui/pagination';

interface DataSourcePaginationProps {
    total: number;
    currentPage: number;
    pageSize: number;
    isFetching: boolean;
    hoverLocked: boolean;
    onPageChange: (page: number) => void;
}

export function DataSourcePagination(props: DataSourcePaginationProps) {
    const {
        total,
        currentPage,
        pageSize,
        isFetching,
        hoverLocked,
        onPageChange,
    } = props;

    if (total === 0) return null;

    const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1);
    const prevDisabled = currentPage === 1 || isFetching;
    const nextDisabled = currentPage >= totalPages || isFetching;
    const ellipsis = 'ellipsis' as const;

    const paginationRange = useMemo(() => {
        const boundaryCount = 1;
        const siblingCount = 1;
        const range = (start: number, end: number) => {
            const length = Math.max(end - start + 1, 0);
            return Array.from({ length }, (_, i) => start + i);
        };
        const totalPageNumbers = boundaryCount * 2 + siblingCount * 2 + 3;
        if (totalPages <= totalPageNumbers) {
            return range(1, totalPages);
        }

        const startPages = range(1, boundaryCount);
        const endPages = range(totalPages - boundaryCount + 1, totalPages);

        const siblingsStart = Math.max(
            Math.min(
                currentPage - siblingCount,
                totalPages - boundaryCount - siblingCount * 2 - 1,
            ),
            boundaryCount + 2,
        );
        const siblingsEnd = Math.min(
            Math.max(
                currentPage + siblingCount,
                boundaryCount + siblingCount * 2 + 2,
            ),
            totalPages - boundaryCount - 1,
        );

        const items: Array<number | 'ellipsis'> = [
            ...startPages,
            ...(siblingsStart > boundaryCount + 2 ? [ellipsis] : [boundaryCount + 1]),
            ...range(siblingsStart, siblingsEnd),
            ...(siblingsEnd < totalPages - boundaryCount - 1 ? [ellipsis] : [totalPages - boundaryCount]),
            ...endPages,
        ];

        return items.filter((item, index, self) => {
            if (item === 'ellipsis') {
                return self[index - 1] !== 'ellipsis';
            }
            return self.indexOf(item) === index;
        });
    }, [currentPage, totalPages]);

    const handlePageClick = (page: number) => {
        if (page < 1 || page > totalPages || page === currentPage || isFetching) {
            return;
        }
        onPageChange(page);
    };

    return (
        <div className="datasource-pagination">
            <div className="datasource-page-info">共 {total} 条数据</div>

            <Pagination className={`datasource-pagination-nav ${hoverLocked ? 'hover-locked' : ''}`} aria-label="数据源分页导航">
                <PaginationContent className="datasource-page-numbers">
                    <PaginationItem>
                        <PaginationLink
                            href="#"
                            className="datasource-nav-btn"
                            aria-disabled={prevDisabled}
                            tabIndex={prevDisabled ? -1 : 0}
                            onClick={(event) => {
                                event.preventDefault();
                                if (!prevDisabled) {
                                    handlePageClick(currentPage - 1);
                                }
                            }}
                        >
                            上一页
                        </PaginationLink>
                    </PaginationItem>
                    {paginationRange.map((item, index) => (
                        item === 'ellipsis' ? (
                            <PaginationItem key={`ellipsis-${index}`}>
                                <PaginationEllipsis className="datasource-pagination-ellipsis">...</PaginationEllipsis>
                            </PaginationItem>
                        ) : (
                            <PaginationItem key={item}>
                                <PaginationLink
                                    href="#"
                                    className={`datasource-page-btn ${item === currentPage ? 'active' : ''}`}
                                    isActive={item === currentPage}
                                    aria-disabled={isFetching}
                                    tabIndex={isFetching ? -1 : 0}
                                    onClick={(event) => {
                                        event.preventDefault();
                                        handlePageClick(item);
                                    }}
                                >
                                    {item}
                                </PaginationLink>
                            </PaginationItem>
                        )
                    ))}
                    <PaginationItem>
                        <PaginationLink
                            href="#"
                            className="datasource-nav-btn"
                            aria-disabled={nextDisabled}
                            tabIndex={nextDisabled ? -1 : 0}
                            onClick={(event) => {
                                event.preventDefault();
                                if (!nextDisabled) {
                                    handlePageClick(currentPage + 1);
                                }
                            }}
                        >
                            下一页
                        </PaginationLink>
                    </PaginationItem>
                </PaginationContent>
            </Pagination>
        </div>
    );
}
