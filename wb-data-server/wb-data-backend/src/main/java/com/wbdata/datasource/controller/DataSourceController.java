package com.wbdata.datasource.controller;

import com.baomidou.mybatisplus.core.metadata.IPage;
import com.wbdata.auth.context.GroupAuthContext;
import com.wbdata.auth.context.RequireGroupAuth;
import com.wbdata.auth.enums.Permission;
import com.wbdata.common.Result;
import com.wbdata.datasource.dto.DataSourceResponse;
import com.wbdata.datasource.dto.DataSourceSaveDTO;
import com.wbdata.datasource.dto.DataSourceSearchQuery;
import com.wbdata.datasource.dto.DataSourceStatusRequest;
import com.wbdata.datasource.dto.TestConnectionRequest;
import com.wbdata.datasource.entity.DataSource;
import com.wbdata.datasource.plugin.DataSourceConnectionPoolManager;
import com.wbdata.datasource.plugin.DataSourcePluginRegistry;
import com.wbdata.datasource.service.AuthorizedDataSourceService;
import com.wbdata.datasource.service.DataSourceService;
import com.wbdata.group.dto.AssetOwnerSummaryResponse;
import com.wbdata.group.dto.GroupOwnerInfo;
import com.wbdata.group.dto.TransferOwnerRequest;
import com.wbdata.group.dto.TransferOwnerResponse;
import com.wbdata.group.service.GroupOwnerService;
import com.wbdata.plugin.api.ConnectionTestResult;
import com.wbdata.plugin.api.DataSourceConnectionInfo;
import com.wbdata.plugin.api.DataSourceException;
import com.wbdata.plugin.api.DataSourcePlugin;
import com.wbdata.plugin.api.DataSourcePluginDescriptor;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.Map;
import java.util.Objects;

@Tag(name = "数据源管理", description = "数据源的增删改查及测试连接")
@RestController
@RequestMapping({"/api/v1/datasources", "/api/v1/groups/{groupId}/datasources"})
@RequiredArgsConstructor
public class DataSourceController {

    private final DataSourceService dataSourceService;
    private final DataSourcePluginRegistry pluginRegistry;
    private final DataSourceConnectionPoolManager poolManager;
    private final AuthorizedDataSourceService authorizedDataSourceService;
    private final GroupOwnerService groupOwnerService;

    @Operation(summary = "数据源插件列表")
    @GetMapping("/plugins")
    public Result<List<DataSourcePluginDescriptor>> plugins() {
        return Result.success(pluginRegistry.getDescriptors());
    }

    @Operation(summary = "数据源分页列表")
    @GetMapping
    public Result<IPage<DataSourceResponse>> list(@RequireGroupAuth(Permission.DATASOURCE_READ) GroupAuthContext context,
                                                  DataSourceSearchQuery query) {
        if (query.getType() != null && !query.getType().isEmpty()) {
            query.setTypeList(java.util.Arrays.asList(query.getType().split(",")));
        }
        query.setGroupId(context.groupId());
        query.validateSort();
        IPage<DataSource> page = dataSourceService.getDataSourcePage(query);
        List<Long> ownerIds = page.getRecords().stream()
                .map(DataSource::getOwnerUserId)
                .filter(Objects::nonNull)
                .toList();
        Map<Long, GroupOwnerInfo> ownerMap = groupOwnerService.resolveOwners(context.groupId(), ownerIds);
        return Result.success(page.convert(ds -> DataSourceResponse.from(ds, ownerMap.get(ds.getOwnerUserId()))));
    }

    @Operation(summary = "数据源负责人分布汇总")
    @GetMapping("/owners")
    public Result<List<AssetOwnerSummaryResponse>> listOwners(
            @RequireGroupAuth(Permission.DATASOURCE_READ) GroupAuthContext context) {
        Map<Long, Long> counts = dataSourceService.countByOwner(context.groupId());
        return Result.success(groupOwnerService.summarizeOwners(context.groupId(), counts));
    }

    @Operation(summary = "批量转移数据源负责人")
    @PostMapping("/transfer-owner")
    public Result<TransferOwnerResponse> transferOwner(
            @RequireGroupAuth(Permission.DATASOURCE_WRITE) GroupAuthContext context,
            @Validated @RequestBody TransferOwnerRequest request) {
        GroupOwnerInfo targetOwner = groupOwnerService.requireAssignableOwner(
                context.groupId(), request.targetOwnerUserId());
        int updated = dataSourceService.transferOwner(
                context.groupId(),
                request.ids(),
                request.fromOwnerUserId(),
                targetOwner.userId(),
                targetOwner.effectiveName(),
                context.user().id()
        );
        return Result.success(new TransferOwnerResponse(
                updated,
                targetOwner.userId(),
                targetOwner.effectiveName()
        ));
    }

    @Operation(summary = "获取数据源详情")
    @GetMapping("/{id}")
    public Result<DataSourceResponse> getById(@PathVariable Long id,
                                              @PathVariable(name = "groupId", required = false) Long groupId) {
        DataSource dataSource = requireDataSourceContext(id, Permission.DATASOURCE_READ);
        ensureDataSourceBelongsToPathGroup(dataSource, groupId);
        GroupOwnerInfo ownerInfo = dataSource.getOwnerUserId() == null
                ? null
                : groupOwnerService.resolveOwners(dataSource.getGroupId(), List.of(dataSource.getOwnerUserId()))
                        .get(dataSource.getOwnerUserId());
        return Result.success(DataSourceResponse.from(dataSource, ownerInfo));
    }

    @Operation(summary = "创建数据源")
    @PostMapping
    public Result<Boolean> save(@RequireGroupAuth(Permission.DATASOURCE_WRITE) GroupAuthContext context,
                                @Validated @RequestBody DataSourceSaveDTO dto) {
        DataSourcePlugin plugin = requireSupportedPlugin(dto.getType());
        Long targetOwnerId = dto.getOwnerUserId() != null ? dto.getOwnerUserId() : context.user().id();
        GroupOwnerInfo ownerInfo = groupOwnerService.requireAssignableOwner(context.groupId(), targetOwnerId);

        DataSource dataSource = new DataSource();
        dataSource.setGroupId(context.groupId());
        dataSource.setName(dto.getName());
        dataSource.setType(dto.getType());
        dataSource.setDescription(dto.getDescription());
        dataSource.setHost(dto.getHost());
        dataSource.setPort(dto.getPort());
        dataSource.setDatabaseName(dto.getDatabaseName());
        dataSource.setUsername(dto.getUsername());
        dataSource.setPassword(dto.getPassword());
        dataSource.setConnectionParams(dto.getConnectionParams());
        dataSource.setOwnerUserId(ownerInfo.userId());
        dataSource.setOwner(ownerInfo.effectiveName());
        dataSource.setCreatedBy(context.user().id());
        dataSource.setUpdatedBy(context.user().id());
        validateConnectionConfig(plugin, dataSource);
        return Result.success(dataSourceService.save(dataSource));
    }

    @Operation(summary = "更新数据源")
    @PutMapping("/{id}")
    public Result<Boolean> update(@RequireGroupAuth(Permission.DATASOURCE_WRITE) GroupAuthContext context,
                                  @PathVariable Long id,
                                  @Validated @RequestBody DataSourceSaveDTO dto) {
        DataSource existing = requireDataSourceInCurrentGroup(context, id, Permission.DATASOURCE_WRITE);
        DataSourcePlugin plugin = requireSupportedPlugin(dto.getType());
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
        if (dto.getOwnerUserId() != null && !Objects.equals(dto.getOwnerUserId(), existing.getOwnerUserId())) {
            GroupOwnerInfo ownerInfo = groupOwnerService.requireAssignableOwner(existing.getGroupId(), dto.getOwnerUserId());
            dataSource.setOwnerUserId(ownerInfo.userId());
            dataSource.setOwner(ownerInfo.effectiveName());
        } else {
            dataSource.setOwnerUserId(existing.getOwnerUserId());
            dataSource.setOwner(existing.getOwner());
        }
        dataSource.setUpdatedBy(context.user().id());
        validateConnectionConfig(plugin, dataSource);
        boolean updated = dataSourceService.updateById(dataSource);
        poolManager.invalidate(id);   // evict stale pool for this data source
        return Result.success(updated);
    }

    @Operation(summary = "删除数据源")
    @DeleteMapping("/{id}")
    public Result<Boolean> delete(@RequireGroupAuth(Permission.DATASOURCE_WRITE) GroupAuthContext context,
                                  @PathVariable Long id) {
        requireDataSourceInCurrentGroup(context, id, Permission.DATASOURCE_WRITE);
        boolean removed = dataSourceService.removeById(id);
        poolManager.invalidate(id);   // close and evict the pool for the deleted data source
        return Result.success(removed);
    }

    @Operation(summary = "更新启用状态")
    @PatchMapping("/{id}/status")
    public Result<Void> updateStatus(@RequireGroupAuth(Permission.DATASOURCE_WRITE) GroupAuthContext context,
                                     @PathVariable Long id,
                                     @Validated @RequestBody DataSourceStatusRequest request) {
        requireDataSourceInCurrentGroup(context, id, Permission.DATASOURCE_WRITE);
        dataSourceService.updateStatus(id, request.status());
        return Result.success(null);
    }

    @Operation(summary = "测试连接 (新建)")
    @PostMapping("/test-connection")
    public Result<ConnectionTestResult> testNewConnection(@RequireGroupAuth(Permission.DATASOURCE_WRITE) GroupAuthContext context,
                                                          @Validated @RequestBody TestConnectionRequest request) {
        return Result.success(dataSourceService.testConnection(request));
    }

    @Operation(summary = "测试连接 (已有)")
    @PostMapping("/{id}/test")
    public Result<ConnectionTestResult> testExistingConnection(@RequireGroupAuth(Permission.DATASOURCE_READ) GroupAuthContext context,
                                                               @PathVariable Long id) {
        requireDataSourceInCurrentGroup(context, id, Permission.DATASOURCE_READ);
        return Result.success(dataSourceService.testConnection(id));
    }

    private DataSource requireDataSourceInCurrentGroup(GroupAuthContext context, Long dataSourceId, Permission permission) {
        DataSource dataSource = requireDataSourceContext(dataSourceId, permission);
        Long currentGroupId = context.groupId();
        if (!currentGroupId.equals(dataSource.getGroupId())) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "数据源不存在");
        }
        return dataSource;
    }

    private void ensureDataSourceBelongsToPathGroup(DataSource dataSource, Long groupId) {
        if (groupId != null && !groupId.equals(dataSource.getGroupId())) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "数据源不存在");
        }
    }

    private DataSource requireDataSourceContext(Long dataSourceId, Permission permission) {
        return authorizedDataSourceService.requireDataSource(dataSourceId, permission);
    }

    private DataSourcePlugin requireSupportedPlugin(String type) {
        return pluginRegistry.getPlugin(type)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.BAD_REQUEST, "暂不支持的数据源类型: " + type));
    }

    private void validateConnectionConfig(DataSourcePlugin plugin, DataSource dataSource) {
        try {
            plugin.validateConnectionInfo(new DataSourceConnectionInfo(
                    dataSource.getId(),
                    dataSource.getType(),
                    dataSource.getHost(),
                    dataSource.getPort(),
                    dataSource.getDatabaseName(),
                    dataSource.getUsername(),
                    dataSource.getPassword(),
                    dataSource.getConnectionParams()
            ));
        } catch (DataSourceException ex) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, ex.getMessage(), ex);
        }
    }
}
