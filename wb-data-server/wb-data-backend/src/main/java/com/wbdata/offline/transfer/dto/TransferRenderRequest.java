package com.wbdata.offline.transfer.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;

import java.util.List;

/** Runtime representation of the persisted transfer sidecar posted by Kestra. */
@JsonIgnoreProperties(ignoreUnknown = true)
public record TransferRenderRequest(
        @NotNull Long groupId,
        @NotNull @Valid TransferEndpointConfig source,
        @NotNull @Valid TransferEndpointConfig target,
        List<@Valid TransferFieldMapping> fieldMappings,
        List<@Valid TransferPartitionMapping> partitions
) {
    public TransferConfig transferConfig() {
        return new TransferConfig(source, target, fieldMappings, partitions);
    }
}
