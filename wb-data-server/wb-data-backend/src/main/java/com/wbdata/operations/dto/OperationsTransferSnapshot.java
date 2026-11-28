package com.wbdata.operations.dto;

import java.util.List;

public record OperationsTransferSnapshot(
        EndpointView source,
        EndpointView target,
        String writeMode,
        List<MappingView> fieldMappings,
        List<MappingView> partitions,
        List<String> preSqlRaw,
        List<String> preSqlRendered,
        List<String> postSqlRaw,
        List<String> postSqlRendered
) {
    public record EndpointView(
            Long dataSourceId,
            String dataSourceName,
            String dataSourceType,
            String database,
            String table,
            String whereRaw,
            String whereRendered
    ) {
    }

    public record MappingView(
            String target,
            String kind,
            String source,
            String expressionRaw,
            String expressionRendered,
            String valueRaw,
            String valueRendered
    ) {
    }
}
