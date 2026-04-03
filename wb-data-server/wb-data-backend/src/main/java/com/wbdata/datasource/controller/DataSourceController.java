package com.wbdata.datasource.controller;

import com.baomidou.mybatisplus.core.metadata.IPage;
import com.wbdata.auth.dto.AuthContextResponse;
import com.wbdata.auth.service.AuthorizedDataSourceService;
import com.wbdata.auth.service.AuthContextService;
import com.wbdata.common.Result;
import com.wbdata.datasource.dto.DataSourceCreateDTO;
import com.wbdata.datasource.dto.DataSourceSearchQuery;
import com.wbdata.datasource.dto.DataSourceUpdateDTO;
import com.wbdata.datasource.dto.TestConnectionRequest;
import com.wbdata.datasource.entity.DataSource;
import com.wbdata.datasource.plugin.DataSourcePluginRegistry;
import com.wbdata.datasource.service.DataSourceService;
import com.wbdata.plugin.api.ConnectionTestResult;
import com.wbdata.plugin.api.DataSourcePluginDescriptor;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpHeaders;
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
    private final com.wbdata.datasource.plugin.DataSourceConnectionPoolManager poolManager;
    private final AuthContextService authContextService;
    private final AuthorizedDataSourceService authorizedDataSourceService;

    @Operation(summary = "数据源插件列表")
    @GetMapping("/plugins")
    public Result<List<DataSourcePluginDescriptor>> plugins() {
        return Result.success(pluginRegistry.getDescriptors());
    }

    @Operation(summary = "数据源分页列表")
    @GetMapping
    public Result<IPage<DataSource>> list(@RequestHeader(HttpHeaders.AUTHORIZATION) String authorization,
                                          DataSourceSearchQuery query) {
        AuthContextResponse context = requireContext(authorization, query.getGroupId(), "datasource.read");
        if (query.getType() != null && !query.getType().isEmpty()) {
            query.setTypeList(java.util.Arrays.asList(query.getType().split(",")));
        }
        query.setGroupId(context.currentGroup().id());
        return Result.success(dataSourceService.getDataSourcePage(query));
    }

    @Operation(summary = "获取数据源详情")
    @GetMapping("/{id}")
    public Result<DataSource> getById(@RequestHeader(HttpHeaders.AUTHORIZATION) String authorization,
                                      @PathVariable Long id) {
        DataSource dataSource = requireDataSourceContext(authorization, id, "datasource.read");
        return Result.success(dataSource);
    }

    @Operation(summary = "创建数据源")
    @PostMapping
    public Result<Boolean> save(@RequestHeader(HttpHeaders.AUTHORIZATION) String authorization,
                                @RequestParam Long groupId,
                                @Validated @RequestBody DataSourceCreateDTO dto) {
        AuthContextResponse context = requireContext(authorization, groupId, "datasource.write");
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
    public Result<Boolean> update(@RequestHeader(HttpHeaders.AUTHORIZATION) String authorization,
                                  @PathVariable Long id,
                                  @Validated @RequestBody DataSourceUpdateDTO dto) {
        DataSource existing = requireDataSourceContext(authorization, id, "datasource.write");
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
        dataSource.setUpdatedBy(authContextService.getContext(authorization, existing.getGroupId()).user().id());
        boolean updated = dataSourceService.updateById(dataSource);
        poolManager.invalidate(id);   // evict stale pool for this data source
        return Result.success(updated);
    }

    @Operation(summary = "删除数据源")
    @DeleteMapping("/{id}")
    public Result<Boolean> delete(@RequestHeader(HttpHeaders.AUTHORIZATION) String authorization,
                                  @PathVariable Long id) {
        requireDataSourceContext(authorization, id, "datasource.write");
        boolean removed = dataSourceService.removeById(id);
        poolManager.invalidate(id);   // close and evict the pool for the deleted data source
        return Result.success(removed);
    }

    @Operation(summary = "更新启用状态")
    @PatchMapping("/{id}/status")
    public Result<Void> updateStatus(@RequestHeader(HttpHeaders.AUTHORIZATION) String authorization,
                                     @PathVariable Long id,
                                     @RequestBody DataSource dataSource) {
        requireDataSourceContext(authorization, id, "datasource.write");
        dataSourceService.updateStatus(id, dataSource.getStatus());
        return Result.success(null);
    }

    @Operation(summary = "测试连接 (新建)")
    @PostMapping("/test-connection")
    public Result<ConnectionTestResult> testNewConnection(@RequestHeader(HttpHeaders.AUTHORIZATION) String authorization,
                                                          @RequestParam Long groupId,
                                                          @Validated @RequestBody TestConnectionRequest request) {
        requireContext(authorization, groupId, "datasource.write");
        return Result.success(dataSourceService.testConnection(request));
    }

    @Operation(summary = "测试连接 (已有)")
    @PostMapping("/{id}/test")
    public Result<ConnectionTestResult> testExistingConnection(@RequestHeader(HttpHeaders.AUTHORIZATION) String authorization,
                                                               @PathVariable Long id) {
        requireDataSourceContext(authorization, id, "datasource.read");
        return Result.success(dataSourceService.testConnection(id));
    }

    private AuthContextResponse requireContext(String authorization, Long groupId, String permission) {
        AuthContextResponse context = authContextService.getContext(authorization, groupId);
        if (context.currentGroup() == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "当前未选中项目组");
        }
        if (!context.permissions().contains(permission)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "当前项目组下无此操作权限: " + permission);
        }
        return context;
    }

    private DataSource requireDataSourceContext(String authorization, Long dataSourceId, String permission) {
        return authorizedDataSourceService.requireDataSource(authorization, dataSourceId, permission);
    }

    private void validatePluginType(String type) {
        if (!pluginRegistry.supports(type)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "暂不支持的数据源类型: " + type);
        }
    }
}
