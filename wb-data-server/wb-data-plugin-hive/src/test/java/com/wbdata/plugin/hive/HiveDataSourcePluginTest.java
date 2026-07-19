package com.wbdata.plugin.hive;

import com.wbdata.plugin.api.TableDetail;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class HiveDataSourcePluginTest {

    @Test
    void parseTableDetailSeparatesHivePartitionColumns() {
        TableDetail detail = HiveDataSourcePlugin.parseTableDetail(List.of(
                List.of("order_id", "bigint", ""),
                List.of("amount", "decimal(10,2)", ""),
                List.of("# Partition Information", "", ""),
                List.of("# col_name", "data_type", "comment"),
                List.of("dayno", "string", "business day"),
                List.of("# Detailed Table Information", "", "")
        ));

        assertThat(detail.columns()).extracting(column -> column.name()).containsExactly("order_id", "amount");
        assertThat(detail.partitionColumns()).extracting(column -> column.name()).containsExactly("dayno");
        assertThat(detail.partitioned()).isTrue();
    }

    @Test
    void parseTableDetailStopsBeforeDetailedInformationForNonPartitionedTable() {
        TableDetail detail = HiveDataSourcePlugin.parseTableDetail(List.of(
                List.of("order_id", "bigint", ""),
                List.of("amount", "decimal(10,2)", ""),
                List.of("# Detailed Table Information", "", ""),
                List.of("Database:", "analytics", ""),
                List.of("Owner:", "hive", ""),
                List.of("Table Parameters:", "", ""),
                List.of("transient_lastDdlTime", "1710000000", "")
        ));

        assertThat(detail.columns()).extracting(column -> column.name()).containsExactly("order_id", "amount");
        assertThat(detail.partitionColumns()).isEmpty();
        assertThat(detail.partitioned()).isFalse();
    }
}
