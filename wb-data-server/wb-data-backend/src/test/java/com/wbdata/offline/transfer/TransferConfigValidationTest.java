package com.wbdata.offline.transfer;

import com.wbdata.offline.dto.SaveOfflineFlowNodeRequest;
import com.wbdata.offline.transfer.dto.TransferConfig;
import com.wbdata.offline.transfer.dto.TransferEndpointConfig;
import com.wbdata.offline.transfer.dto.TransferFieldMapping;
import com.wbdata.offline.transfer.dto.TransferMappingKind;
import com.wbdata.offline.transfer.dto.TransferPartitionMapping;
import com.wbdata.offline.transfer.dto.TransferWriteMode;
import jakarta.validation.Validation;
import jakarta.validation.Validator;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class TransferConfigValidationTest {

    private static Validator validator;

    @BeforeAll
    static void setUpValidator() {
        validator = Validation.buildDefaultValidatorFactory().getValidator();
    }

    @Test
    void acceptsTransferNodeWithoutScriptContent() {
        SaveOfflineFlowNodeRequest request = new SaveOfflineFlowNodeRequest(
                "transfer_node_01",
                null,
                "TRANSFER",
                null,
                null,
                null,
                validTransfer()
        );

        assertThat(validator.validate(request)).isEmpty();
    }

    @Test
    void acceptsTaskIdWithLeadingDigit() {
        SaveOfflineFlowNodeRequest request = new SaveOfflineFlowNodeRequest(
                "1transfer_node",
                null,
                "TRANSFER",
                null,
                null,
                null,
                validTransfer()
        );

        assertThat(validator.validate(request)).isEmpty();
    }

    @Test
    void rejectsTaskIdWithHyphen() {
        SaveOfflineFlowNodeRequest request = new SaveOfflineFlowNodeRequest(
                "transfer-node",
                null,
                "TRANSFER",
                null,
                null,
                null,
                validTransfer()
        );

        assertThat(validator.validate(request))
                .extracting(violation -> violation.getPropertyPath().toString())
                .contains("taskId");
    }

    @Test
    void requiresScriptFieldsForScriptNodes() {
        SaveOfflineFlowNodeRequest request = new SaveOfflineFlowNodeRequest(
                "shell_node_01",
                null,
                "SHELL",
                null,
                null,
                null,
                null
        );

        assertThat(validator.validate(request)).extracting(violation -> violation.getPropertyPath().toString())
                .contains("validForNodeKind");
    }

    @Test
    void rejectsInvalidTaskIdAndUnsupportedEndpointType() {
        TransferConfig transfer = new TransferConfig(
                new TransferEndpointConfig(1L, "MYSQL", "source_db", "orders", null, null),
                new TransferEndpointConfig(2L, "ELASTICSEARCH", "target_db", "orders", null, TransferWriteMode.APPEND),
                List.of(),
                List.of()
        );
        SaveOfflineFlowNodeRequest request = new SaveOfflineFlowNodeRequest(
                "bad task id",
                null,
                "TRANSFER",
                null,
                null,
                null,
                transfer
        );

        assertThat(validator.validate(request)).extracting(violation -> violation.getPropertyPath().toString())
                .contains("taskId", "transfer.target.dataSourceType");
    }

    @Test
    void requiresEndpointIdsAndTables() {
        TransferConfig transfer = new TransferConfig(
                new TransferEndpointConfig(null, "MYSQL", "source_db", " ", null, null),
                new TransferEndpointConfig(null, "HIVE", "target_db", "", null, TransferWriteMode.APPEND),
                List.of(),
                List.of()
        );

        assertThat(validator.validate(transfer)).extracting(violation -> violation.getPropertyPath().toString())
                .contains("source.dataSourceId", "source.table", "target.dataSourceId", "target.table");
    }

    @Test
    void rejectsStatementsInPredicateAndExpressionFragments() {
        TransferConfig transfer = new TransferConfig(
                new TransferEndpointConfig(1L, "MYSQL", "source_db", "orders", "id = 1;", null),
                new TransferEndpointConfig(2L, "HIVE", "target_db", "orders", null, TransferWriteMode.APPEND),
                List.of(new TransferFieldMapping("dayno", TransferMappingKind.SOURCE_EXPRESSION, null,
                        "select current_date")),
                List.of()
        );

        assertThat(validator.validate(transfer)).extracting(violation -> violation.getPropertyPath().toString())
                .contains("source.where", "fieldMappings[0].expression");
    }

    @Test
    void rejectsOverwritePartitionWithoutPartitionMappings() {
        TransferConfig transfer = new TransferConfig(
                new TransferEndpointConfig(1L, "MYSQL", "source_db", "orders", null, null),
                new TransferEndpointConfig(2L, "HIVE", "target_db", "dwd_orders", null,
                        TransferWriteMode.OVERWRITE_PARTITION),
                List.of(),
                List.of()
        );

        assertThat(validator.validate(transfer)).extracting(violation -> violation.getPropertyPath().toString())
                .contains("validWriteModeForPartitions");
    }

    @Test
    void rejectsOverwriteTableForPartitionedTarget() {
        TransferConfig transfer = new TransferConfig(
                new TransferEndpointConfig(1L, "MYSQL", "source_db", "orders", null, null),
                new TransferEndpointConfig(2L, "HIVE", "target_db", "dwd_orders", null,
                        TransferWriteMode.OVERWRITE_TABLE),
                List.of(),
                List.of(new TransferPartitionMapping("dt", TransferMappingKind.STATIC_VALUE, null, null, "2026-07-19"))
        );

        assertThat(validator.validate(transfer)).extracting(violation -> violation.getPropertyPath().toString())
                .contains("validWriteModeForPartitions");
    }

    @Test
    void rejectsOverwritePartitionForNonHiveTarget() {
        TransferConfig transfer = new TransferConfig(
                new TransferEndpointConfig(1L, "MYSQL", "source_db", "orders", null, null),
                new TransferEndpointConfig(2L, "MYSQL", "target_db", "dwd_orders", null,
                        TransferWriteMode.OVERWRITE_PARTITION),
                List.of(),
                List.of(new TransferPartitionMapping("dt", TransferMappingKind.STATIC_VALUE, null, null, "2026-07-19"))
        );

        assertThat(validator.validate(transfer)).extracting(violation -> violation.getPropertyPath().toString())
                .contains("validWriteModeForPartitions");
    }

    @Test
    void rejectsPartitionMappingsForNonHiveTargetRegardlessOfWriteMode() {
        for (TransferWriteMode writeMode : new TransferWriteMode[]{TransferWriteMode.APPEND, null}) {
            TransferConfig transfer = new TransferConfig(
                    new TransferEndpointConfig(1L, "MYSQL", "source_db", "orders", null, null),
                    new TransferEndpointConfig(2L, "MYSQL", "target_db", "dwd_orders", null, writeMode),
                    List.of(),
                    List.of(new TransferPartitionMapping("dt", TransferMappingKind.STATIC_VALUE, null, null, "2026-07-19"))
            );

            assertThat(validator.validate(transfer)).extracting(violation -> violation.getPropertyPath().toString())
                    .contains("validPartitionTarget");
        }
    }

    private static TransferConfig validTransfer() {
        return new TransferConfig(
                new TransferEndpointConfig(1L, "MYSQL", "source_db", "orders", "id > 0", null),
                new TransferEndpointConfig(2L, "HIVE", "target_db", "dwd_orders", null, TransferWriteMode.APPEND),
                List.of(new TransferFieldMapping("order_id", TransferMappingKind.SOURCE_FIELD, "id", null)),
                List.of()
        );
    }
}
