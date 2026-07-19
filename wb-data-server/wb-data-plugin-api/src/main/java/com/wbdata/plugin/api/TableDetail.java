package com.wbdata.plugin.api;

import java.util.List;

public record TableDetail(
        List<ColumnMetadata> columns,
        List<PartitionColumnMetadata> partitionColumns,
        boolean partitioned
) {
}
