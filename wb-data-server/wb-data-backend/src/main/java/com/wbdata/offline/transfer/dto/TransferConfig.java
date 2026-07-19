package com.wbdata.offline.transfer.dto;

import com.fasterxml.jackson.annotation.JsonIgnore;
import jakarta.validation.Valid;
import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.NotNull;

import java.util.List;

public record TransferConfig(
        @NotNull @Valid TransferEndpointConfig source,
        @NotNull @Valid TransferEndpointConfig target,
        List<@Valid TransferFieldMapping> fieldMappings,
        List<@Valid TransferPartitionMapping> partitions
) {
    @AssertTrue(message = "Partition mappings require a HIVE target")
    @JsonIgnore
    public boolean isValidPartitionTarget() {
        boolean hasPartitionMappings = partitions != null && !partitions.isEmpty();
        return !hasPartitionMappings || (target != null && "HIVE".equals(target.dataSourceType()));
    }

    @AssertTrue(message = "Partition mappings require a HIVE target and append or overwrite_partition mode")
    @JsonIgnore
    public boolean isValidWriteModeForPartitions() {
        if (target == null || target.writeMode() == null) {
            return true;
        }

        boolean hasPartitionMappings = partitions != null && !partitions.isEmpty();
        return switch (target.writeMode()) {
            case APPEND -> true;
            case OVERWRITE_TABLE -> !hasPartitionMappings;
            case OVERWRITE_PARTITION -> hasPartitionMappings && "HIVE".equals(target.dataSourceType());
        };
    }
}
