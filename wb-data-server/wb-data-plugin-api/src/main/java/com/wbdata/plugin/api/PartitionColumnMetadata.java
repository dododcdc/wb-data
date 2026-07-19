package com.wbdata.plugin.api;

public record PartitionColumnMetadata(
        String name,
        String type,
        String remarks
) {
}
