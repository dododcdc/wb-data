package com.wbdata.offline.transfer.service;

import com.wbdata.offline.transfer.dto.TransferConfig;
import com.wbdata.offline.transfer.dto.TransferEndpointConfig;
import com.wbdata.offline.transfer.dto.TransferFieldMapping;
import com.wbdata.offline.transfer.dto.TransferMappingKind;
import com.wbdata.offline.transfer.dto.TransferPartitionMapping;
import com.wbdata.offline.transfer.dto.TransferWriteMode;
import com.wbdata.plugin.api.ColumnMetadata;
import com.wbdata.plugin.api.PartitionColumnMetadata;
import com.wbdata.plugin.api.TableDetail;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatIllegalArgumentException;

class TransferSqlBuilderTest {

    private final TransferSqlBuilder builder = new TransferSqlBuilder();

    @Test
    void buildsMysqlSourceSqlFromTargetFieldsAndMappings() {
        TransferConfig config = config(
                List.of(
                        new TransferFieldMapping("order_id", TransferMappingKind.SOURCE_FIELD, "id", null),
                        new TransferFieldMapping("amount", TransferMappingKind.SOURCE_EXPRESSION, null, "price * quantity")),
                List.of(), TransferWriteMode.APPEND);

        assertThat(builder.buildSourceSql(config, detail(false)))
                .isEqualTo("select `id` as `order_id`, price * quantity as `amount` from `orders` where status = 'paid'");
    }

    @Test
    void quotesAndEscapesPostgresqlIdentifiers() {
        TransferConfig config = new TransferConfig(
                new TransferEndpointConfig(1L, "POSTGRESQL", "sales", "order\"line", "active = true", null),
                new TransferEndpointConfig(2L, "MYSQL", "warehouse", "dwd_orders", null, TransferWriteMode.APPEND),
                List.of(
                        new TransferFieldMapping("order\"id", TransferMappingKind.SOURCE_FIELD, "source\"id", null),
                        new TransferFieldMapping("amount", TransferMappingKind.STATIC_VALUE, null, null, "0")),
                List.of());

        assertThat(builder.buildSourceSql(config, new TableDetail(
                List.of(column("order\"id"), column("amount")), List.of(), false)))
                .isEqualTo("select \"source\"\"id\" as \"order\"\"id\", '0' as \"amount\" from \"order\"\"line\" where active = true");
    }

    @Test
    void addsDynamicHivePartitionMappingsToSourceSqlAndHiveWriteSql() {
        TransferConfig config = config(
                List.of(
                        new TransferFieldMapping("order_id", TransferMappingKind.SOURCE_FIELD, "id", null),
                        new TransferFieldMapping("amount", TransferMappingKind.SOURCE_FIELD, "amount", null)),
                List.of(new TransferPartitionMapping("dt", TransferMappingKind.SOURCE_FIELD, "order_day", null, null)),
                TransferWriteMode.OVERWRITE_PARTITION);

        assertThat(builder.buildSourceSql(config, detail(true)))
                .isEqualTo("select `id` as `order_id`, `amount` as `amount`, `order_day` as `dt` from `orders` where status = 'paid'");
    }

    @Test
    void createsStaticHivePartitionAssignmentInWriteSql() {
        TransferConfig config = config(
                List.of(
                        new TransferFieldMapping("order_id", TransferMappingKind.SOURCE_FIELD, "id", null),
                        new TransferFieldMapping("amount", TransferMappingKind.SOURCE_FIELD, "amount", null)),
                List.of(new TransferPartitionMapping("dt", TransferMappingKind.STATIC_VALUE, null, null, "2026-07-19")),
                TransferWriteMode.OVERWRITE_PARTITION);

        assertThat(builder.buildSourceSql(config, detail(true)))
                .isEqualTo("select `id` as `order_id`, `amount` as `amount`, '2026-07-19' as `dt` from `orders` where status = 'paid'");
    }

    @Test
    void rejectsMissingTargetNonPartitionFieldMapping() {
        TransferConfig config = config(
                List.of(new TransferFieldMapping("order_id", TransferMappingKind.SOURCE_FIELD, "id", null)),
                List.of(), TransferWriteMode.APPEND);

        assertThatIllegalArgumentException()
                .isThrownBy(() -> builder.buildSourceSql(config, detail(false)))
                .withMessage("Missing mapping for target field: amount");
    }

    @Test
    void rejectsMissingHivePartitionMappingForOverwritePartition() {
        TransferConfig config = config(
                List.of(
                        new TransferFieldMapping("order_id", TransferMappingKind.SOURCE_FIELD, "id", null),
                        new TransferFieldMapping("amount", TransferMappingKind.SOURCE_FIELD, "amount", null)),
                List.of(), TransferWriteMode.OVERWRITE_PARTITION);

        assertThatIllegalArgumentException()
                .isThrownBy(() -> builder.buildSourceSql(config, detail(true)))
                .withMessage("Missing mapping for Hive partition: dt");
    }

    @Test
    void rejectsOverwritePartitionForNonPartitionedHiveTarget() {
        TransferConfig config = config(
                List.of(
                        new TransferFieldMapping("order_id", TransferMappingKind.SOURCE_FIELD, "id", null),
                        new TransferFieldMapping("amount", TransferMappingKind.SOURCE_FIELD, "amount", null)),
                List.of(new TransferPartitionMapping("dt", TransferMappingKind.STATIC_VALUE,
                        null, null, "2026-07-19")),
                TransferWriteMode.OVERWRITE_PARTITION);

        assertThatIllegalArgumentException()
                .isThrownBy(() -> builder.buildSourceSql(config, detail(false)))
                .withMessage("overwrite_partition requires a partitioned Hive target");
    }

    @Test
    void rejectsHivePartitionMappingThatIsNotInTargetMetadata() {
        TransferConfig config = config(
                List.of(
                        new TransferFieldMapping("order_id", TransferMappingKind.SOURCE_FIELD, "id", null),
                        new TransferFieldMapping("amount", TransferMappingKind.SOURCE_FIELD, "amount", null)),
                List.of(new TransferPartitionMapping("configured_dt", TransferMappingKind.STATIC_VALUE,
                        null, null, "2026-07-19")),
                TransferWriteMode.APPEND);

        assertThatIllegalArgumentException()
                .isThrownBy(() -> builder.buildSourceSql(config, detail(true)))
                .withMessage("Partition mapping does not match Hive target: configured_dt");
    }

    @Test
    void rejectsOverwriteTableForPartitionedHiveTarget() {
        TransferConfig config = config(
                List.of(
                        new TransferFieldMapping("order_id", TransferMappingKind.SOURCE_FIELD, "id", null),
                        new TransferFieldMapping("amount", TransferMappingKind.SOURCE_FIELD, "amount", null)),
                List.of(), TransferWriteMode.OVERWRITE_TABLE);

        assertThatIllegalArgumentException()
                .isThrownBy(() -> builder.buildSourceSql(config, detail(true)))
                .withMessage("overwrite_table is not allowed for a partitioned Hive target");
    }

    private TransferConfig config(List<TransferFieldMapping> fields,
                                  List<TransferPartitionMapping> partitions,
                                  TransferWriteMode writeMode) {
        return new TransferConfig(
                new TransferEndpointConfig(1L, "MYSQL", "sales", "orders", "status = 'paid'", null),
                new TransferEndpointConfig(2L, "HIVE", "warehouse", "dwd_orders", null, writeMode),
                fields,
                partitions);
    }

    private TableDetail detail(boolean partitioned) {
        return new TableDetail(
                List.of(column("order_id"), column("amount")),
                partitioned ? List.of(new PartitionColumnMetadata("dt", "string", "")) : List.of(),
                partitioned);
    }

    private ColumnMetadata column(String name) {
        return new ColumnMetadata(name, "bigint", 0, false, "", false);
    }
}
