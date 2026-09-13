package com.wbdata.offline.service;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class OfflineFlowNodeKindsTest {

    @Test
    void treatsLegacySqlAndJdbcKindsAsJdbcSql() {
        assertThat(OfflineFlowNodeKinds.isJdbcSql("SQL")).isTrue();
        assertThat(OfflineFlowNodeKinds.isJdbcSql("MYSQL")).isTrue();
        assertThat(OfflineFlowNodeKinds.isJdbcSql("POSTGRESQL")).isTrue();
        assertThat(OfflineFlowNodeKinds.isJdbcSql("CLICKHOUSE")).isTrue();
        assertThat(OfflineFlowNodeKinds.isJdbcSql("HIVE_SQL")).isFalse();
        assertThat(OfflineFlowNodeKinds.isJdbcSql("SHELL")).isFalse();
        assertThat(OfflineFlowNodeKinds.isJdbcSql("TRANSFER")).isFalse();
    }

    @Test
    void upgradesLegacySqlKindFromDataSourceType() {
        assertThat(OfflineFlowNodeKinds.canonicalize("SQL", "MYSQL")).isEqualTo("MYSQL");
        assertThat(OfflineFlowNodeKinds.canonicalize("SQL", "POSTGRESQL")).isEqualTo("POSTGRESQL");
        assertThat(OfflineFlowNodeKinds.canonicalize("sql", "clickhouse")).isEqualTo("CLICKHOUSE");
        assertThat(OfflineFlowNodeKinds.canonicalize("SQL", null)).isEqualTo("SQL");
        assertThat(OfflineFlowNodeKinds.canonicalize("MYSQL", "MYSQL")).isEqualTo("MYSQL");
        assertThat(OfflineFlowNodeKinds.canonicalize("HIVE_SQL", "HIVE")).isEqualTo("HIVE_SQL");
    }

    @Test
    void requiresDataSourceForJdbcAndHiveSqlKinds() {
        assertThat(OfflineFlowNodeKinds.requiresDataSource("MYSQL")).isTrue();
        assertThat(OfflineFlowNodeKinds.requiresDataSource("SQL")).isTrue();
        assertThat(OfflineFlowNodeKinds.requiresDataSource("HIVE_SQL")).isTrue();
        assertThat(OfflineFlowNodeKinds.requiresDataSource("SHELL")).isFalse();
        assertThat(OfflineFlowNodeKinds.requiresDataSource("TRANSFER")).isFalse();
    }
}
