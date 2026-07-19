package com.wbdata.offline.transfer.dto;

import com.wbdata.plugin.api.ColumnMetadata;
import com.wbdata.plugin.api.PartitionColumnMetadata;

import java.util.List;

public record TransferTableMetadataResponse(
        List<ColumnMetadata> columns,
        List<PartitionColumnMetadata> partitionColumns,
        boolean partitioned,
        List<TransferWriteModeOption> writeModes
) {
}
