import { Pagination } from '@ark-ui/react/pagination';

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

    return (
        <div className="datasource-pagination">
            <div className="datasource-page-info">共 {total} 条数据</div>

            <Pagination.Root
                boundaryCount={1}
                className={`datasource-pagination-nav ${hoverLocked ? 'hover-locked' : ''}`}
                count={total}
                page={currentPage}
                pageSize={pageSize}
                siblingCount={1}
                translations={{
                    rootLabel: '数据源分页导航',
                    prevTriggerLabel: '上一页',
                    nextTriggerLabel: '下一页',
                    itemLabel: ({ page, totalPages }) => `第 ${page} 页，共 ${totalPages} 页`,
                }}
                onPageChange={({ page }) => onPageChange(page)}
            >
                <Pagination.PrevTrigger className="datasource-nav-btn" disabled={currentPage === 1 || isFetching}>
                    上一页
                </Pagination.PrevTrigger>
                <div className="datasource-page-numbers">
                    <Pagination.Context>
                        {(pagination) =>
                            pagination.pages.map((item, index) =>
                                item.type === 'page' ? (
                                    <Pagination.Item
                                        key={item.value}
                                        {...item}
                                        className={`datasource-page-btn ${item.value === currentPage ? 'active' : ''}`}
                                        disabled={isFetching}
                                    >
                                        {item.value}
                                    </Pagination.Item>
                                ) : (
                                    <Pagination.Ellipsis
                                        key={`ellipsis-${index}`}
                                        className="datasource-pagination-ellipsis"
                                        index={index}
                                    >
                                        ...
                                    </Pagination.Ellipsis>
                                ),
                            )
                        }
                    </Pagination.Context>
                </div>
                <Pagination.NextTrigger className="datasource-nav-btn" disabled={isFetching || currentPage >= Math.ceil(total / pageSize)}>
                    下一页
                </Pagination.NextTrigger>
            </Pagination.Root>
        </div>
    );
}
