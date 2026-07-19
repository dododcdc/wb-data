package com.wbdata.offline.transfer.service;

import com.wbdata.datasource.entity.DataSource;
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
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatIllegalArgumentException;

class TransferSeatunnelConfigBuilderTest {

    private final TransferSeatunnelConfigBuilder builder = new TransferSeatunnelConfigBuilder();

    @Test
    void rendersMysqlToMysqlAppendConfig() {
        assertThat(builder.build(input("MYSQL", "MYSQL", TransferWriteMode.APPEND, List.of(), false)))
                .isEqualTo("""
                        env {
                          parallelism = 1
                          job.mode = \"BATCH\"
                        }
                        source {
                          Jdbc {
                            url = \"jdbc:mysql://source-db:3306/sales\"
                            driver = \"com.mysql.cj.jdbc.Driver\"
                            user = \"source_user\"
                            password = \"source-password\"
                            query = \"select `id` as `order_id`, `amount` as `amount` from `orders` where status = 'paid'\"
                          }
                        }
                        sink {
                          Jdbc {
                            plugin_name = \"Jdbc\"
                            url = \"jdbc:mysql://target-db:3306/warehouse\"
                            driver = \"com.mysql.cj.jdbc.Driver\"
                            user = \"target_user\"
                            password = \"target-password\"
                            database = \"warehouse\"
                            table = \"dwd_orders\"
                            generate_sink_sql = true
                            schema_save_mode = \"ERROR_WHEN_SCHEMA_NOT_EXIST\"
                            data_save_mode = \"APPEND_DATA\"
                          }
                        }
                        """);
    }

    @Test
    void rendersMysqlToMysqlOverwriteTableConfig() {
        assertThat(builder.build(input("MYSQL", "MYSQL", TransferWriteMode.OVERWRITE_TABLE, List.of(), false)))
                .isEqualTo("""
                        env {
                          parallelism = 1
                          job.mode = \"BATCH\"
                        }
                        source {
                          Jdbc {
                            url = \"jdbc:mysql://source-db:3306/sales\"
                            driver = \"com.mysql.cj.jdbc.Driver\"
                            user = \"source_user\"
                            password = \"source-password\"
                            query = \"select `id` as `order_id`, `amount` as `amount` from `orders` where status = 'paid'\"
                          }
                        }
                        sink {
                          Jdbc {
                            plugin_name = \"Jdbc\"
                            url = \"jdbc:mysql://target-db:3306/warehouse\"
                            driver = \"com.mysql.cj.jdbc.Driver\"
                            user = \"target_user\"
                            password = \"target-password\"
                            database = \"warehouse\"
                            table = \"dwd_orders\"
                            generate_sink_sql = true
                            schema_save_mode = \"ERROR_WHEN_SCHEMA_NOT_EXIST\"
                            data_save_mode = \"DROP_DATA\"
                          }
                        }
                        """);
    }

    @Test
    void rendersMysqlToHiveStaticPartitionOverwriteConfig() {
        assertThat(builder.build(input("MYSQL", "HIVE", TransferWriteMode.OVERWRITE_PARTITION,
                List.of(new TransferPartitionMapping("dt", TransferMappingKind.STATIC_VALUE, null, null, "2026-07-19")), true)))
                .isEqualTo("""
                        env {
                          parallelism = 1
                          job.mode = \"BATCH\"
                        }
                        source {
                          Jdbc {
                            url = \"jdbc:mysql://source-db:3306/sales\"
                            driver = \"com.mysql.cj.jdbc.Driver\"
                            user = \"source_user\"
                            password = \"source-password\"
                            query = \"select `id` as `order_id`, `amount` as `amount`, '2026-07-19' as `dt` from `orders` where status = 'paid'\"
                          }
                        }
                        sink {
                          Hive {
                            table_name = \"warehouse.dwd_orders\"
                            partition_by = [\"dt\"]
                            metastore_uri = \"thrift://test-metastore:9083\"
                            data_save_mode = \"DROP_DATA\"
                          }
                        }
                        """);
    }

    @Test
    void rendersMysqlToHiveDynamicPartitionOverwriteConfig() {
        assertThat(builder.build(input("MYSQL", "HIVE", TransferWriteMode.OVERWRITE_PARTITION,
                List.of(new TransferPartitionMapping("dt", TransferMappingKind.SOURCE_FIELD, "order_day", null, null)), true)))
                .isEqualTo("""
                        env {
                          parallelism = 1
                          job.mode = \"BATCH\"
                        }
                        source {
                          Jdbc {
                            url = \"jdbc:mysql://source-db:3306/sales\"
                            driver = \"com.mysql.cj.jdbc.Driver\"
                            user = \"source_user\"
                            password = \"source-password\"
                            query = \"select `id` as `order_id`, `amount` as `amount`, `order_day` as `dt` from `orders` where status = 'paid'\"
                          }
                        }
                        sink {
                          Hive {
                            table_name = \"warehouse.dwd_orders\"
                            partition_by = [\"dt\"]
                            metastore_uri = \"thrift://test-metastore:9083\"
                            data_save_mode = \"DROP_DATA\"
                          }
                        }
                        """);
    }

    @Test
    void rendersHiveToMysqlAppendConfig() {
        assertThat(builder.build(input("HIVE", "MYSQL", TransferWriteMode.APPEND, List.of(), false)))
                .isEqualTo("""
                        env {
                          parallelism = 1
                          job.mode = \"BATCH\"
                        }
                        source {
                          Jdbc {
                            url = \"jdbc:hive2://source-db:10000/sales\"
                            driver = \"org.apache.hive.jdbc.HiveDriver\"
                            user = \"source_user\"
                            password = \"source-password\"
                            query = \"select `id` as `order_id`, `amount` as `amount` from `orders` where status = 'paid'\"
                          }
                        }
                        sink {
                          Jdbc {
                            plugin_name = \"Jdbc\"
                            url = \"jdbc:mysql://target-db:3306/warehouse\"
                            driver = \"com.mysql.cj.jdbc.Driver\"
                            user = \"target_user\"
                            password = \"target-password\"
                            database = \"warehouse\"
                            table = \"dwd_orders\"
                            generate_sink_sql = true
                            schema_save_mode = \"ERROR_WHEN_SCHEMA_NOT_EXIST\"
                            data_save_mode = \"APPEND_DATA\"
                          }
                        }
                        """);
    }

    @Test
    void rejectsHivePartitionMappingNotPresentInTargetMetadata() {
        assertThatIllegalArgumentException()
                .isThrownBy(() -> builder.build(input("MYSQL", "HIVE", TransferWriteMode.APPEND,
                        List.of(new TransferPartitionMapping("configured_dt", TransferMappingKind.STATIC_VALUE,
                                null, null, "2026-07-19")), false)))
                .withMessage("Partition mapping does not match Hive target: configured_dt");
    }

    private TransferRenderInput input(String sourceType,
                                      String targetType,
                                      TransferWriteMode writeMode,
                                      List<TransferPartitionMapping> partitions,
                                      boolean partitioned) {
        TransferConfig config = new TransferConfig(
                new TransferEndpointConfig(1L, sourceType, "sales", "orders", "status = 'paid'", null),
                new TransferEndpointConfig(2L, targetType, "warehouse", "dwd_orders", null, writeMode),
                List.of(
                        new TransferFieldMapping("order_id", TransferMappingKind.SOURCE_FIELD, "id", null),
                        new TransferFieldMapping("amount", TransferMappingKind.SOURCE_FIELD, "amount", null)),
                partitions);
        return new TransferRenderInput(config, dataSource(sourceType, "source-db", "source_default", "source_user", "source-password"),
                dataSource(targetType, "target-db", "target_default", "target_user", "target-password"),
                new TableDetail(List.of(column("order_id"), column("amount")),
                        partitioned ? List.of(new PartitionColumnMetadata("dt", "string", "")) : List.of(), partitioned));
    }

    private DataSource dataSource(String type, String host, String database, String username, String password) {
        DataSource dataSource = new DataSource();
        dataSource.setType(type);
        dataSource.setHost(host);
        dataSource.setPort("HIVE".equals(type) ? 10000 : 3306);
        dataSource.setDatabaseName(database);
        if ("HIVE".equals(type)) {
            dataSource.setConnectionParams(Map.of("metastoreUri", "thrift://test-metastore:9083"));
        }
        dataSource.setUsername(username);
        dataSource.setPassword(password);
        return dataSource;
    }

    private ColumnMetadata column(String name) {
        return new ColumnMetadata(name, "bigint", 0, false, "", false);
    }
}
