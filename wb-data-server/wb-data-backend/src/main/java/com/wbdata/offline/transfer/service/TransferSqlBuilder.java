package com.wbdata.offline.transfer.service;

import com.wbdata.offline.transfer.dto.TransferConfig;
import com.wbdata.offline.transfer.dto.TransferFieldMapping;
import com.wbdata.offline.transfer.dto.TransferMappingKind;
import com.wbdata.offline.transfer.dto.TransferPartitionMapping;
import com.wbdata.offline.transfer.dto.TransferWriteMode;
import com.wbdata.plugin.api.ColumnMetadata;
import com.wbdata.plugin.api.PartitionColumnMetadata;
import com.wbdata.plugin.api.TableDetail;
import com.wbdata.sql.SqlParameterTemplate;
import com.wbdata.sql.SqlStringLiteral;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

public final class TransferSqlBuilder {

    private final SqlIdentifierQuoter identifierQuoter = new SqlIdentifierQuoter();

    public String buildSourceSql(TransferConfig config, TableDetail targetTableDetail) {
        return buildSourceSql(config, null, targetTableDetail);
    }

    public String buildSourceSql(TransferConfig config, TableDetail sourceTableDetail, TableDetail targetTableDetail) {
        return buildSourceSql(config, sourceTableDetail, targetTableDetail, Map.of());
    }

    public String buildSourceSql(TransferConfig config, TableDetail sourceTableDetail, TableDetail targetTableDetail,
                                 Map<String, String> parameters) {
        TransferParameters.requireValues(config, parameters);
        validateHiveWriteMode(config, targetTableDetail);
        List<String> selections = new ArrayList<>();
        for (ColumnMetadata column : targetTableDetail.columns()) {
            TransferFieldMapping mapping = findFieldMapping(config, column.name());
            if (mapping == null) {
                mapping = defaultSameNameMapping(sourceTableDetail, column.name());
            }
            if (mapping == null) {
                throw new IllegalArgumentException("Missing mapping for target field: " + column.name());
            }
            selections.add(renderMapping(mapping.kind(), mapping.source(), mapping.expression(), mapping.value(),
                    config.source().dataSourceType(), column.name(), parameters));
        }
        for (PartitionColumnMetadata partition : targetTableDetail.partitionColumns()) {
            TransferPartitionMapping mapping = findPartitionMapping(config, partition.name());
            if (mapping != null) {
                selections.add(renderMapping(mapping.kind(), mapping.source(), mapping.expression(), mapping.value(),
                        config.source().dataSourceType(), partition.name(), parameters));
            }
        }
        if (selections.isEmpty()) {
            throw new IllegalArgumentException("Target table has no columns to transfer");
        }
        String sourceType = config.source().dataSourceType();
        String sql = "select " + String.join(", ", selections) + " from "
                + identifierQuoter.quote(sourceType, config.source().table());
        return config.source().where() == null || config.source().where().isBlank()
                ? sql : sql + " where " + renderSql(config.source().where(), sourceType, parameters);
    }

    private void validateHiveWriteMode(TransferConfig config, TableDetail targetTableDetail) {
        if (!"HIVE".equals(config.target().dataSourceType())) {
            return;
        }
        if (config.target().writeMode() == TransferWriteMode.OVERWRITE_PARTITION
                && (!targetTableDetail.partitioned() || targetTableDetail.partitionColumns() == null
                || targetTableDetail.partitionColumns().isEmpty())) {
            throw new IllegalArgumentException("overwrite_partition requires a partitioned Hive target");
        }
        validateHivePartitionMappings(config, targetTableDetail);
        if (targetTableDetail.partitioned() && config.target().writeMode() == TransferWriteMode.OVERWRITE_TABLE) {
            throw new IllegalArgumentException("overwrite_table is not allowed for a partitioned Hive target");
        }
        if (config.target().writeMode() == TransferWriteMode.OVERWRITE_PARTITION) {
            for (PartitionColumnMetadata partition : targetTableDetail.partitionColumns()) {
                if (findPartitionMapping(config, partition.name()) == null) {
                    throw new IllegalArgumentException("Missing mapping for Hive partition: " + partition.name());
                }
            }
        }

    }

    private void validateHivePartitionMappings(TransferConfig config, TableDetail targetTableDetail) {
        List<PartitionColumnMetadata> targetPartitions = targetTableDetail.partitionColumns() == null
                ? List.of() : targetTableDetail.partitionColumns();
        List<TransferPartitionMapping> configuredPartitions = config.partitions() == null
                ? List.of() : config.partitions();
        for (TransferPartitionMapping mapping : configuredPartitions) {
            if (targetPartitions.stream().noneMatch(partition -> partition.name().equals(mapping.target()))) {
                throw new IllegalArgumentException("Partition mapping does not match Hive target: " + mapping.target());
            }
        }
    }

    private String renderMapping(TransferMappingKind kind, String source, String expression, String value,
                                 String sourceType, String target, Map<String, String> parameters) {
        String rendered = switch (kind) {
            case SOURCE_FIELD -> identifierQuoter.quote(sourceType, requireValue(source, "Source field"));
            case SOURCE_EXPRESSION -> renderSql(requireValue(expression, "Source expression"), sourceType, parameters);
            case STATIC_VALUE -> SqlStringLiteral.render(sourceType,
                    TransferParameters.renderText(requireValue(value, "Static value"), parameters));
        };
        return rendered + " as " + identifierQuoter.quote(sourceType, target);
    }

    private String renderSql(String sql, String sourceType, Map<String, String> parameters) {
        return SqlParameterTemplate.render(sql, name -> SqlStringLiteral.render(sourceType, parameters.get(name)));
    }

    private TransferFieldMapping findFieldMapping(TransferConfig config, String target) {
        return config.fieldMappings() == null ? null : config.fieldMappings().stream()
                .filter(mapping -> target.equals(mapping.target()))
                .findFirst().orElse(null);
    }

    private TransferFieldMapping defaultSameNameMapping(TableDetail sourceTableDetail, String target) {
        if (sourceTableDetail == null || sourceTableDetail.columns() == null) {
            return null;
        }
        return sourceTableDetail.columns().stream()
                .map(ColumnMetadata::name)
                .filter(target::equals)
                .findFirst()
                .map(source -> new TransferFieldMapping(target, TransferMappingKind.SOURCE_FIELD, source, null))
                .orElse(null);
    }

    private TransferPartitionMapping findPartitionMapping(TransferConfig config, String target) {
        return config.partitions() == null ? null : config.partitions().stream()
                .filter(mapping -> target.equals(mapping.target()))
                .findFirst().orElse(null);
    }

    private String requireValue(String value, String label) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(label + " must not be blank");
        }
        return value;
    }

}
