package com.wbdata.offline.transfer.service;

import com.wbdata.datasource.entity.DataSource;
import com.wbdata.offline.transfer.dto.TransferWriteMode;
import com.wbdata.plugin.api.PartitionColumnMetadata;

import java.util.List;

public final class TransferSeatunnelConfigBuilder {

    private final TransferSqlBuilder sqlBuilder = new TransferSqlBuilder();
    private final JdbcDriverCatalog driverCatalog = new JdbcDriverCatalog();

    public String build(TransferRenderInput input) {
        if (input == null || input.transferConfig() == null || input.targetTableDetail() == null) {
            throw new IllegalArgumentException("Transfer render input is required");
        }
        String sourceQuery = sqlBuilder.buildSourceSql(input.transferConfig(), input.targetTableDetail());
        JdbcDriverCatalog.JdbcConnection source = driverCatalog.resolve(
                input.sourceDataSource(), input.transferConfig().source().database());
        StringBuilder config = new StringBuilder("""
                env {
                  parallelism = 1
                  job.mode = \"BATCH\"
                }
                source {
                  Jdbc {
                """);
        appendJdbcConnection(config, source, input.sourceDataSource());
        config.append("    query = \"").append(escape(sourceQuery)).append("\"\n")
                .append("  }\n}");
        if ("HIVE".equals(input.transferConfig().target().dataSourceType())) {
            appendHiveSink(config, input);
        } else {
            appendJdbcSink(config, input);
        }
        return config.append('\n').toString();
    }

    private void appendJdbcSink(StringBuilder config, TransferRenderInput input) {
        JdbcDriverCatalog.JdbcConnection target = driverCatalog.resolve(
                input.targetDataSource(), input.transferConfig().target().database());
        TransferWriteMode mode = input.transferConfig().target().writeMode();
        String dataSaveMode = mode == null ? "APPEND_DATA" : switch (mode) {
            case APPEND -> "APPEND_DATA";
            case OVERWRITE_TABLE -> "DROP_DATA";
            case OVERWRITE_PARTITION -> throw new IllegalArgumentException("overwrite_partition requires a Hive target");
        };
        config.append("\nsink {\n  Jdbc {\n    plugin_name = \"Jdbc\"\n");
        appendJdbcConnection(config, target, input.targetDataSource());
        config.append("    database = \"").append(escape(input.transferConfig().target().database())).append("\"\n")
                .append("    table = \"").append(escape(input.transferConfig().target().table())).append("\"\n")
                .append("    generate_sink_sql = true\n")
                .append("    schema_save_mode = \"ERROR_WHEN_SCHEMA_NOT_EXIST\"\n")
                .append("    data_save_mode = \"").append(dataSaveMode).append("\"\n  }\n}");
    }

    private void appendHiveSink(StringBuilder config, TransferRenderInput input) {
        TransferWriteMode mode = input.transferConfig().target().writeMode();
        String dataSaveMode = mode == null ? "APPEND_DATA" : switch (mode) {
            case APPEND -> "APPEND_DATA";
            case OVERWRITE_TABLE, OVERWRITE_PARTITION -> "DROP_DATA";
        };
        config.append("\nsink {\n  Hive {\n")
                .append("    table_name = \"")
                .append(escape(input.transferConfig().target().database()))
                .append(".")
                .append(escape(input.transferConfig().target().table()))
                .append("\"\n");
        appendHivePartitions(config, input);
        config.append("    metastore_uri = \"").append(escape(resolveHiveMetastoreUri(input.targetDataSource())))
                .append("\"\n")
                .append("    data_save_mode = \"").append(dataSaveMode).append("\"\n  }\n}");
    }

    private void appendHivePartitions(StringBuilder config, TransferRenderInput input) {
        List<PartitionColumnMetadata> partitions = input.targetTableDetail().partitionColumns();
        if (partitions == null || partitions.isEmpty()) {
            return;
        }
        config.append("    partition_by = [");
        for (int index = 0; index < partitions.size(); index++) {
            if (index > 0) {
                config.append(", ");
            }
            config.append("\"").append(escape(partitions.get(index).name())).append("\"");
        }
        config.append("]\n");
    }

    private void appendJdbcConnection(StringBuilder config, JdbcDriverCatalog.JdbcConnection connection, DataSource dataSource) {
        config.append("    url = \"").append(escape(connection.url())).append("\"\n")
                .append("    driver = \"").append(connection.driver()).append("\"\n")
                .append("    user = \"").append(escape(dataSource.getUsername())).append("\"\n")
                .append("    password = \"").append(escape(dataSource.getPassword())).append("\"\n");
    }

    private String resolveHiveMetastoreUri(DataSource dataSource) {
        Object configuredUri = dataSource.getConnectionParams() == null ? null
                : dataSource.getConnectionParams().get("metastoreUri");
        if (configuredUri instanceof String uri && !uri.isBlank()) {
            return uri;
        }
        if (dataSource.getHost() == null || dataSource.getHost().isBlank() || dataSource.getPort() == null) {
            throw new IllegalArgumentException("Hive data source host and port are required");
        }
        return "thrift://" + dataSource.getHost() + ":" + dataSource.getPort();
    }

    private String escape(String value) {
        return value == null ? "" : value.replace("\\", "\\\\").replace("\"", "\\\"");
    }
}
