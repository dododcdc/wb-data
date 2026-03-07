package com.wbdata.query.controller;

import com.wbdata.common.Result;
import com.wbdata.plugin.api.QueryResult;
import com.wbdata.plugin.api.TableMetadata;
import com.wbdata.query.service.MetadataService;
import com.wbdata.query.service.QueryService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@Tag(name = "自助查询", description = "SQL查询与元数据获取")
@RestController
@RequestMapping("/api/v1/query")
@RequiredArgsConstructor
public class QueryController {

    private final MetadataService metadataService;
    private final QueryService queryService;

    @Operation(summary = "获取数据源下的所有数据库")
    @GetMapping("/metadata/{dataSourceId}/databases")
    public Result<List<String>> getDatabases(@PathVariable Long dataSourceId) {
        return Result.success(metadataService.getDatabases(dataSourceId));
    }

    @Operation(summary = "获取数据库下的表结构")
    @GetMapping("/metadata/{dataSourceId}/{databaseName}/tables")
    public Result<List<TableMetadata>> getTables(@PathVariable Long dataSourceId, @PathVariable String databaseName) {
        return Result.success(metadataService.getTables(dataSourceId, databaseName));
    }

    @Operation(summary = "执行SQL查询")
    @PostMapping("/execute/{dataSourceId}")
    public Result<QueryResult> execute(@PathVariable Long dataSourceId, @RequestBody String sql) {
        return Result.success(queryService.executeQuery(dataSourceId, sql));
    }
}
