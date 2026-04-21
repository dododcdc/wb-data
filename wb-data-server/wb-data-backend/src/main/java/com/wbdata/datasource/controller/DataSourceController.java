package com.wbdata.datasource.controller;

import com.baomidou.mybatisplus.core.metadata.IPage;
import com.wbdata.auth.context.RequireGroupAuth;
import com.wbdata.auth.dto.AuthContextResponse;
import com.wbdata.auth.enums.Permission;
import com.wbdata.auth.service.AuthorizedDataSourceService;
import com.wbdata.common.Result;
import com.wbdata.datasource.dto.DataSourceSaveDTO;
import com.wbdata.datasource.dto.DataSourceSearchQuery;
import com.wbdata.datasource.dto.DataSourceStatusRequest;
import com.wbdata.datasource.dto.TestConnectionRequest;
import com.wbdata.datasource.entity.DataSource;
import com.wbdata.datasource.plugin.DataSourceConnectionPoolManager;
import com.wbdata.datasource.plugin.DataSourcePluginRegistry;
import com.wbdata.datasource.service.DataSourceService;
import com.wbdata.plugin.api.ConnectionTestResult;
import com.wbdata.plugin.api.DataSourcePluginDescriptor;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;

@Tag(name = "数据源管理", description = "数据源的增删改查及测试连接")
@RestController
@RequestMapping("/api/v1/datasources")
@RequiredArgsConstructor
public class DataSourceController {

    private final DataSourceService dataSourceService;
    private final DataSourcePluginRegistry pluginRegistry;
    private final DataSourceConnectionPoolManager poolManager;
    private final AuthorizedDataSourceService authorizedDataSourceService;

    @Operation(summary = "数据源插件列表")
    @GetMapping("/plugins")
    public Result<List<DataSourcePluginDescriptor>> plugins() {
        return Result.success(pluginRegistry.getDescriptors());
    }

    @Operation(summary = "数据源分页列表")
    @GetMapping
    public Result<IPage<DataSource>> list(@RequireGroupAuth(Permission.DATASOURCE_READ) AuthContextResponse context,
                                          DataSourceSearchQuery query) {
        if (query.getType() != null && !query.getType().isEmpty()) {
            query.setTypeList(java.util.Arrays.asList(query.getType().split(",")));
        }
        query.setGroupId(context.currentGroup().id());
        query.validateSort();
        return Result.success(dataSourceService.getDataSourcePage(query));
    }

    @Operation(summary = "获取数据源详情")
    @GetMapping("/{id}")
    public Result<DataSource> getById(@PathVariable Long id) {
        DataSource dataSource = requireDataSourceContext(id, "datasource.read");
        return Result.success(dataSource);
    }

    @Operation(summary = "创建数据源")
    @PostMapping
    public Result<Boolean> save(@RequireGroupAuth(Permission.DATASOURCE_WRITE) AuthContextResponse context,
                                @Validated @RequestBody DataSourceSaveDTO dto) {
        validatePluginType(dto.getType());
        DataSource dataSource = new DataSource();
        dataSource.setGroupId(context.currentGroup().id());
        dataSource.setName(dto.getName());
        dataSource.setType(dto.getType());
        dataSource.setDescription(dto.getDescription());
        dataSource.setHost(dto.getHost());
        dataSource.setPort(dto.getPort());
        dataSource.setDatabaseName(dto.getDatabaseName());
        dataSource.setUsername(dto.getUsername());
        dataSource.setPassword(dto.getPassword());
        dataSource.setConnectionParams(dto.getConnectionParams());
        dataSource.setOwner(context.user().username());
        dataSource.setCreatedBy(context.user().id());
        dataSource.setUpdatedBy(context.user().id());
        return Result.success(dataSourceService.save(dataSource));
    }

    @Operation(summary = "更新数据源")
    @PutMapping("/{id}")
    public Result<Boolean> update(@RequireGroupAuth(Permission.DATASOURCE_WRITE) AuthContextResponse context,
                                  @PathVariable Long id,
                                  @Validated @RequestBody DataSourceSaveDTO dto) {
        DataSource existing = requireDataSourceContext(id, Permission.DATASOURCE_WRITE.code());
        validatePluginType(dto.getType());
        DataSource dataSource = new DataSource();
        dataSource.setId(id);
        dataSource.setGroupId(existing.getGroupId());
        dataSource.setName(dto.getName());
        dataSource.setType(dto.getType());
        dataSource.setDescription(dto.getDescription());
        dataSource.setHost(dto.getHost());
        dataSource.setPort(dto.getPort());
        dataSource.setDatabaseName(dto.getDatabaseName());
        dataSource.setUsername(dto.getUsername());
        if (dto.getPassword() != null && !dto.getPassword().isBlank()) {
            dataSource.setPassword(dto.getPassword());
        }
        dataSource.setConnectionParams(dto.getConnectionParams());
        dataSource.setOwner(existing.getOwner());
        dataSource.setUpdatedBy(context.user().id());
        boolean updated = dataSourceService.updateById(dataSource);
        poolManager.invalidate(id);   // evict stale pool for this data source
        return Result.success(updated);
    }

    @Operation(summary = "删除数据源")
    @DeleteMapping("/{id}")
    public Result<Boolean> delete(@RequireGroupAuth(Permission.DATASOURCE_WRITE) AuthContextResponse context,
                                  @PathVariable Long id) {
        requireDataSourceContext(id, Permission.DATASOURCE_WRITE.code());
        boolean removed = dataSourceService.removeById(id);
        poolManager.invalidate(id);   // close and evict the pool for the deleted data source
        return Result.success(removed);
    }

    @Operation(summary = "更新启用状态")
    @PatchMapping("/{id}/status")
    public Result<Void> updateStatus(@RequireGroupAuth(Permission.DATASOURCE_WRITE) AuthContextResponse context,
                                     @PathVariable Long id,
                                     @Validated @RequestBody DataSourceStatusRequest request) {
        requireDataSourceContext(id, Permission.DATASOURCE_WRITE.code());
        dataSourceService.updateStatus(id, request.status());
        return Result.success(null);
    }

    @Operation(summary = "测试连接 (新建)")
    @PostMapping("/test-connection")
    public Result<ConnectionTestResult> testNewConnection(@RequireGroupAuth(Permission.DATASOURCE_WRITE) AuthContextResponse context,
                                                          @Validated @RequestBody TestConnectionRequest request) {
        return Result.success(dataSourceService.testConnection(request));
    }

    @Operation(summary = "测试连接 (已有)")
    @PostMapping("/{id}/test")
    public Result<ConnectionTestResult> testExistingConnection(@RequireGroupAuth(Permission.DATASOURCE_READ) AuthContextResponse context,
                                                               @PathVariable Long id) {
        requireDataSourceContext(id, Permission.DATASOURCE_READ.code());
        return Result.success(dataSourceService.testConnection(id));
    }

    private DataSource requireDataSourceContext(Long dataSourceId, String permission) {
        return authorizedDataSourceService.requireDataSource(dataSourceId, permission);
    }

    private void validatePluginType(String type) {
        if (!pluginRegistry.supports(type)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "暂不支持的数据源类型: " + type);
        }
    }
}
