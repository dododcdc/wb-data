package com.wbdata.query.controller;

import com.wbdata.common.Result;
import com.wbdata.plugin.api.ColumnMetadata;
import com.wbdata.plugin.api.PageResult;
import com.wbdata.plugin.api.QueryResult;
import com.wbdata.plugin.api.TableSummary;
import com.wbdata.query.service.MetadataService;
import com.wbdata.query.service.QueryService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/**
 * 自助查询控制器
 * 提供 SQL 查询与元数据获取的 REST API 接口
 */
@Tag(name = "自助查询", description = "SQL查询与元数据获取")
@RestController
@RequestMapping("/api/v1/query")
@RequiredArgsConstructor
public class QueryController {

    private final MetadataService metadataService;
    private final QueryService queryService;

    /**
     * 获取数据源下的所有数据库列表
     */
    @Operation(summary = "获取数据源下的所有数据库")
    @GetMapping("/metadata/{dataSourceId}/databases")
    public Result<List<String>> getDatabases(@PathVariable Long dataSourceId) {
        return Result.success(metadataService.getDatabases(dataSourceId));
    }

    /**
     * 获取数据库下的表结构信息
     */
    @Operation(summary = "获取数据库下的表结构")
    @GetMapping("/metadata/{dataSourceId}/{databaseName}/tables")
    public Result<PageResult<TableSummary>> getTables(@PathVariable Long dataSourceId,
                                                 @PathVariable String databaseName,
                                                 @RequestParam(required = false) String keyword,
                                                 @RequestParam(defaultValue = "1") int page,
                                                 @RequestParam(defaultValue = "200") int size) {
        return Result.success(metadataService.getTables(dataSourceId, databaseName, keyword, page, size));
    }

    @Operation(summary = "获取指定表的字段信息")
    @GetMapping("/metadata/{dataSourceId}/{databaseName}/tables/{tableName}/columns")
    public Result<List<ColumnMetadata>> getColumns(@PathVariable Long dataSourceId,
                                                    @PathVariable String databaseName,
                                                    @PathVariable String tableName) {
        return Result.success(metadataService.getColumns(dataSourceId, databaseName, tableName));
    }

    /**
     * 执行 SQL 查询
     */
    @Operation(summary = "执行SQL查询")
    @PostMapping("/execute/{dataSourceId}")
    public Result<QueryResult> execute(@PathVariable Long dataSourceId, @RequestBody QueryRequest request) {
        return Result.success(queryService.executeQuery(dataSourceId, request.sql(), request.database()));
    }

    /**
     * 获取数据源的 SQL 智能提示语言特性
     */
    @Operation(summary = "获取数据源的SQL智能提示语言特性")
    @GetMapping("/metadata/{dataSourceId}/dialect")
    public Result<com.wbdata.plugin.api.DialectMetadata> getDialectMetadata(@PathVariable Long dataSourceId) {
        return Result.success(metadataService.getDialectMetadata(dataSourceId));
    }
}
