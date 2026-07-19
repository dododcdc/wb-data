package com.wbdata.offline.transfer.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.wbdata.offline.transfer.dto.TransferConfig;
import com.wbdata.offline.transfer.dto.TransferEndpointConfig;
import com.wbdata.offline.transfer.dto.TransferFieldMapping;
import com.wbdata.offline.transfer.dto.TransferMappingKind;
import com.wbdata.offline.transfer.dto.TransferPartitionMapping;
import com.wbdata.offline.transfer.dto.TransferWriteMode;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class TransferConfigFileServiceTest {

    @TempDir
    Path tempDir;

    private final TransferConfigFileService service = new TransferConfigFileService(new ObjectMapper());

    @Test
    void writeAndRead_persistsWrapperMetadataAndTransferPayload() throws Exception {
        TransferConfig transfer = validTransfer();

        String path = service.write(tempDir, 7L, "_flows/orders/flow.yaml", "transfer_1", transfer);

        assertThat(path).isEqualTo("transfers/orders/transfer_1.transfer.json");
        String content = Files.readString(tempDir.resolve(path));
        assertThat(content)
                .contains("\"schemaVersion\" : 1")
                .contains("\"groupId\" : 7")
                .contains("\"flowPath\" : \"_flows/orders/flow.yaml\"")
                .contains("\"taskId\" : \"transfer_1\"")
                .contains("\"source\"")
                .contains("\"target\"")
                .contains("\"writeMode\" : \"overwrite_partition\"")
                .contains("\"fieldMappings\"")
                .contains("\"partitions\"");
        assertThat(service.read(tempDir, path)).usingRecursiveComparison().isEqualTo(transfer);
    }

    @Test
    void deleteStaleForFlow_removesOnlyTransferFilesNoLongerReferenced() throws Exception {
        String kept = service.write(tempDir, 7L, "_flows/orders/flow.yaml", "kept", validTransfer());
        String stale = service.write(tempDir, 7L, "_flows/orders/flow.yaml", "stale", validTransfer());
        Path unrelated = tempDir.resolve("transfers/other/unrelated.transfer.json");
        Files.createDirectories(unrelated.getParent());
        Files.writeString(unrelated, "{}");

        service.deleteStaleForFlow(tempDir, "_flows/orders/flow.yaml", List.of(kept));

        assertThat(tempDir.resolve(kept)).isRegularFile();
        assertThat(tempDir.resolve(stale)).doesNotExist();
        assertThat(unrelated).isRegularFile();
    }

    private TransferConfig validTransfer() {
        return new TransferConfig(
                new TransferEndpointConfig(1L, "MYSQL", "source_db", "orders", null, null),
                new TransferEndpointConfig(2L, "HIVE", "target_db", "dwd_orders", null,
                        TransferWriteMode.OVERWRITE_PARTITION),
                List.of(new TransferFieldMapping("order_id", TransferMappingKind.SOURCE_FIELD, "id", null)),
                List.of(new TransferPartitionMapping(
                        "dt", TransferMappingKind.STATIC_VALUE, null, null, "2026-07-19"
                ))
        );
    }
}
