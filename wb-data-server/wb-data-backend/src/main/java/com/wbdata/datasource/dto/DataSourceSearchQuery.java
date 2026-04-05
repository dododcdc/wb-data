package com.wbdata.datasource.dto;

import lombok.Data;
import java.util.List;
import java.util.Set;

@Data
public class DataSourceSearchQuery {
    private Long groupId;
    private String keyword;
    private String type;
    private List<String> typeList;
    private String status;
    private String sortField;
    private String sortOrder = "desc";
    private Integer page = 1;
    private Integer size = 10;

    /** sortField 白名单，防止 SQL 注入 */
    private static final Set<String> ALLOWED_SORT_FIELDS = Set.of(
            "name", "type", "status", "created_at", "updated_at"
    );

    /** sortOrder 白名单 */
    private static final Set<String> ALLOWED_SORT_ORDERS = Set.of("ASC", "DESC", "asc", "desc");

    /**
     * 校验排序字段，防止 SQL 注入。
     * 如果 sortField 不在白名单中，重置为 null（使用默认排序）。
     */
    public void validateSort() {
        if (sortField != null && !sortField.isBlank()) {
            if (!ALLOWED_SORT_FIELDS.contains(sortField)) {
                this.sortField = null;
                this.sortOrder = "desc";
            }
        }
        if (sortOrder != null && !ALLOWED_SORT_ORDERS.contains(sortOrder)) {
            this.sortOrder = "desc";
        }
    }
}
