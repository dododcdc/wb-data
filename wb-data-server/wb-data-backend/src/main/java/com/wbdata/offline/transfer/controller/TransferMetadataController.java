package com.wbdata.offline.transfer.controller;

import com.wbdata.auth.context.RequireGroupAuth;
import com.wbdata.auth.dto.AuthContextResponse;
import com.wbdata.auth.enums.Permission;
import com.wbdata.auth.service.AuthorizedDataSourceService;
import com.wbdata.common.Result;
import com.wbdata.datasource.entity.DataSource;
import com.wbdata.offline.transfer.dto.TransferTableMetadataResponse;
import com.wbdata.offline.transfer.service.TransferMetadataService;
import com.wbdata.plugin.api.PageResult;
import com.wbdata.plugin.api.TableSummary;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;

@Tag(name = "离线开发", description = "Transfer 节点元数据")
@RestController
@RequestMapping("/api/v1/groups/{groupId}/offline/transfer/datasources/{dataSourceId}")
@RequiredArgsConstructor
public class TransferMetadataController {

    private final TransferMetadataService transferMetadataService;
    private final AuthorizedDataSourceService authorizedDataSourceService;

    @Operation(summary = "获取 Transfer 数据源数据库列表")
    @GetMapping("/databases")
    public Result<List<String>> getDatabases(
            @RequireGroupAuth(Permission.OFFLINE_READ) AuthContextResponse context,
            @PathVariable Long groupId,
            @PathVariable Long dataSourceId) {
        requireDataSourceInGroup(dataSourceId, groupId);
        return Result.success(transferMetadataService.getDatabases(dataSourceId));
    }

    @Operation(summary = "获取 Transfer 数据源表列表")
    @GetMapping("/tables")
    public Result<PageResult<TableSummary>> getTables(
            @RequireGroupAuth(Permission.OFFLINE_READ) AuthContextResponse context,
            @PathVariable Long groupId,
            @PathVariable Long dataSourceId,
            @RequestParam(required = false) String databaseName,
            @RequestParam(required = false) String keyword,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "200") int size) {
        requireDataSourceInGroup(dataSourceId, groupId);
        return Result.success(transferMetadataService.getTables(dataSourceId, databaseName, keyword, page, size));
    }

    @Operation(summary = "获取 Transfer 目标表元数据")
    @GetMapping("/tables/{tableName}/metadata")
    public Result<TransferTableMetadataResponse> getTableMetadata(
            @RequireGroupAuth(Permission.OFFLINE_READ) AuthContextResponse context,
            @PathVariable Long groupId,
            @PathVariable Long dataSourceId,
            @PathVariable String tableName,
            @RequestParam(required = false) String databaseName) {
        requireDataSourceInGroup(dataSourceId, groupId);
        return Result.success(transferMetadataService.getTableMetadata(dataSourceId, databaseName, tableName));
    }

    private void requireDataSourceInGroup(Long dataSourceId, Long groupId) {
        DataSource dataSource = authorizedDataSourceService.requireDataSource(dataSourceId, Permission.DATASOURCE_READ.code());
        if (!groupId.equals(dataSource.getGroupId())) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "数据源不存在");
        }
    }
}
