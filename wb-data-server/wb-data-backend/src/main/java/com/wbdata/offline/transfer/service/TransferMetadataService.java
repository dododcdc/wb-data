package com.wbdata.offline.transfer.service;

import com.wbdata.datasource.entity.DataSource;
import com.wbdata.datasource.plugin.DataSourcePluginRegistry;
import com.wbdata.datasource.service.DataSourceService;
import com.wbdata.offline.transfer.dto.TransferTableMetadataResponse;
import com.wbdata.offline.transfer.dto.TransferWriteModeOption;
import com.wbdata.plugin.api.DataSourceConnectionInfo;
import com.wbdata.plugin.api.PageResult;
import com.wbdata.plugin.api.TableDetail;
import com.wbdata.plugin.api.TableSummary;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.Set;

@Service
@RequiredArgsConstructor
public class TransferMetadataService {

    private static final Set<String> SUPPORTED_TYPES = Set.of("MYSQL", "POSTGRESQL", "STARROCKS", "HIVE");
    private static final List<TransferWriteModeOption> NON_PARTITIONED_WRITE_MODES = List.of(
            new TransferWriteModeOption("append", "Append"),
            new TransferWriteModeOption("overwrite_table", "Overwrite table"));
    private static final List<TransferWriteModeOption> HIVE_PARTITIONED_WRITE_MODES = List.of(
            new TransferWriteModeOption("append", "Append"),
            new TransferWriteModeOption("overwrite_partition", "Overwrite partition"));

    private final DataSourceService dataSourceService;
    private final DataSourcePluginRegistry pluginRegistry;

    public List<String> getDatabases(Long dataSourceId) {
        DataSource dataSource = requireSupportedDataSource(dataSourceId);
        return pluginRegistry.getPlugin(dataSource.getType())
                .map(plugin -> plugin.getDatabases(buildConnectionInfo(dataSource)))
                .orElseThrow(() -> unsupportedType(dataSource.getType()));
    }

    public PageResult<TableSummary> getTables(Long dataSourceId, String databaseName, String keyword, int page, int size) {
        DataSource dataSource = requireSupportedDataSource(dataSourceId);
        return pluginRegistry.getPlugin(dataSource.getType())
                .map(plugin -> plugin.getTables(buildConnectionInfo(dataSource), databaseName, keyword, page, size))
                .orElseThrow(() -> unsupportedType(dataSource.getType()));
    }

    public TransferTableMetadataResponse getTableMetadata(Long dataSourceId, String databaseName, String tableName) {
        DataSource dataSource = requireSupportedDataSource(dataSourceId);
        TableDetail detail = getTableDetail(dataSource, databaseName, tableName);
        List<TransferWriteModeOption> writeModes = "HIVE".equals(dataSource.getType()) && detail.partitioned()
                ? HIVE_PARTITIONED_WRITE_MODES
                : NON_PARTITIONED_WRITE_MODES;
        return new TransferTableMetadataResponse(
                detail.columns(),
                detail.partitionColumns(),
                detail.partitioned(),
                writeModes);
    }

    public DataSource requireSupportedDataSource(Long dataSourceId) {
        DataSource dataSource = dataSourceService.getById(dataSourceId);
        if (dataSource == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "数据源不存在");
        }
        if (!SUPPORTED_TYPES.contains(dataSource.getType())) {
            throw unsupportedType(dataSource.getType());
        }
        return dataSource;
    }

    private ResponseStatusException unsupportedType(String type) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, "暂不支持的数据源类型: " + type);
    }

    public TableDetail getTableDetail(DataSource dataSource, String databaseName, String tableName) {
        return pluginRegistry.getPlugin(dataSource.getType())
                .map(plugin -> plugin.getTableDetail(buildConnectionInfo(dataSource), databaseName, tableName))
                .orElseThrow(() -> unsupportedType(dataSource.getType()));
    }

    private DataSourceConnectionInfo buildConnectionInfo(DataSource dataSource) {
        return new DataSourceConnectionInfo(
                dataSource.getId(),
                dataSource.getType(),
                dataSource.getHost(),
                dataSource.getPort(),
                dataSource.getDatabaseName(),
                dataSource.getUsername(),
                dataSource.getPassword(),
                dataSource.getConnectionParams());
    }
}
