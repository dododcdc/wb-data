package com.wbdata.offline.transfer.service;

import com.wbdata.datasource.entity.DataSource;
import com.wbdata.datasource.plugin.DataSourcePluginRegistry;
import com.wbdata.offline.transfer.config.TransferInternalProperties;
import com.wbdata.offline.transfer.dto.TransferEndpointConfig;
import com.wbdata.offline.transfer.dto.TransferFieldMapping;
import com.wbdata.offline.transfer.dto.TransferMappingKind;
import com.wbdata.offline.transfer.dto.TransferPartitionMapping;
import com.wbdata.offline.transfer.dto.TransferRenderRequest;
import com.wbdata.offline.transfer.dto.TransferWriteMode;
import com.wbdata.plugin.api.DataSourceConnectionInfo;
import com.wbdata.plugin.api.DataSourcePlugin;
import com.wbdata.plugin.api.SqlExecutionException;
import jakarta.validation.Validation;
import jakarta.validation.ValidatorFactory;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.ArgumentCaptor;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import java.sql.SQLException;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.same;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class TransferSqlExecutionServiceTest {

    private final ValidatorFactory validatorFactory = Validation.buildDefaultValidatorFactory();
    private final TransferMetadataService metadata = mock(TransferMetadataService.class);
    private final DataSourcePluginRegistry plugins = mock(DataSourcePluginRegistry.class);
    private final DataSourcePlugin plugin = mock(DataSourcePlugin.class);
    private final TransferInternalProperties properties = new TransferInternalProperties();
    private final TransferSqlExecutionService service;

    TransferSqlExecutionServiceTest() {
        properties.setInternalToken("internal-token");
        properties.setSqlTimeoutSeconds(17);
        service = new TransferSqlExecutionService(
                new TransferExecutionGuard(properties, metadata, validatorFactory.getValidator()), plugins, properties);
    }

    @AfterEach
    void closeValidator() {
        validatorFactory.close();
    }

    @ParameterizedTest
    @ValueSource(strings = {"MYSQL", "POSTGRESQL", "CLICKHOUSE"})
    void usesSelectedDatabaseAndPreservesSqlOrder(String type) {
        prepare(type);
        List<String> pre = List.of("TRUNCATE TABLE orders", "INSERT INTO audit VALUES ('start')");
        List<String> post = List.of("INSERT INTO audit VALUES ('done')");
        TransferRenderRequest request = request(type, pre, post);

        assertThat(service.executePreSql("internal-token", request, Map.of())).contains("2 条");
        assertThat(service.executePostSql("internal-token", request, Map.of())).contains("1 条");
        ArgumentCaptor<DataSourceConnectionInfo> connection = ArgumentCaptor.forClass(DataSourceConnectionInfo.class);
        verify(plugin).executeStatements(connection.capture(), eq(pre), eq(Map.of()), eq(17));
        assertThat(connection.getValue().databaseName()).isEqualTo("selected_db");
        assertThat(connection.getValue().host()).isEqualTo("localhost");
        assertThat(connection.getValue().dataSourceId()).isEqualTo(2L);
        assertThat(connection.getValue().connectionParams()).containsEntry("jdbcParams", "test=true");
        verify(plugin).executeStatements(any(), eq(post), eq(Map.of()), eq(17));
    }

    @Test
    void emptyHooksNeverOpenPluginConnectionIncludingHive() {
        prepare("HIVE");
        TransferRenderRequest request = request("HIVE", null, List.of());
        assertThat(service.executePreSql("internal-token", request, Map.of())).isEmpty();
        assertThat(service.executePostSql("internal-token", request, Map.of())).isEmpty();
        verifyNoInteractions(plugins, plugin);
    }

    @Test
    void authenticatesBeforeReadingDatasourcesEvenWithoutHooks() {
        assertThatThrownBy(() -> service.executePreSql(null, request("MYSQL", null, null), Map.of()))
                .isInstanceOf(ResponseStatusException.class)
                .extracting(e -> ((ResponseStatusException) e).getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
        assertThatThrownBy(() -> service.executePostSql("wrong", request("MYSQL", null, null), Map.of()))
                .isInstanceOf(ResponseStatusException.class);
        verifyNoInteractions(metadata, plugins, plugin);
    }

    @Test
    void rejectsOtherGroupAndMismatchedTypeBeforeOpeningConnection() {
        prepare("MYSQL");
        DataSource otherGroup = dataSource(2L, "MYSQL");
        otherGroup.setGroupId(99L);
        when(metadata.requireSupportedDataSource(2L)).thenReturn(otherGroup);
        assertThatThrownBy(() -> service.executePreSql("internal-token", request("MYSQL", List.of("SELECT 1"), null), Map.of()))
                .isInstanceOf(ResponseStatusException.class)
                .extracting(e -> ((ResponseStatusException) e).getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        when(metadata.requireSupportedDataSource(2L)).thenReturn(dataSource(2L, "POSTGRESQL"));
        assertThatThrownBy(() -> service.executePostSql("internal-token", request("MYSQL", null, List.of("SELECT 1")), Map.of()))
                .isInstanceOf(ResponseStatusException.class).hasMessageContaining("类型不匹配");
        verifyNoInteractions(plugin);
    }

    @Test
    void validatesBothSqlListsBeforeRunningPreSql() {
        TransferRenderRequest tooMany = request("MYSQL", List.of("TRUNCATE TABLE orders"), Collections.nCopies(6, "SELECT 1"));
        assertThatThrownBy(() -> service.executePreSql("internal-token", tooMany, Map.of()))
                .isInstanceOf(ResponseStatusException.class).hasMessageContaining("后置 SQL 最多 5 条");
        TransferRenderRequest multipleStatements = request("MYSQL", List.of("SELECT 1; SELECT 2"), null);
        assertThatThrownBy(() -> service.executePreSql("internal-token", multipleStatements, Map.of()))
                .isInstanceOf(ResponseStatusException.class).hasMessageContaining("一条完整语句");
        assertThatThrownBy(() -> service.executePreSql("internal-token", request("HIVE", List.of("SELECT 1"), null), Map.of()))
                .isInstanceOf(ResponseStatusException.class).hasMessageContaining("仅支持");
        verifyNoInteractions(metadata, plugins, plugin);
    }

    @Test
    void postFailureIdentifiesStatementAndDoesNotLeakDriverDetails() {
        prepare("MYSQL");
        doThrow(new SqlExecutionException(2, new SQLException("password=secret; SELECT confidential_data")))
                .when(plugin).executeStatements(any(), anyList(), anyMap(), anyInt());
        TransferRenderRequest request = request("MYSQL", List.of(), List.of("SELECT 1", "SELECT 2", "SELECT 3"));
        assertThatThrownBy(() -> service.executePostSql("internal-token", request, Map.of()))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("后置 SQL第 2 条执行失败").hasMessageContaining("数据已写入，未回滚，请手动处理")
                .hasMessageNotContaining("secret").hasMessageNotContaining("confidential_data");
    }

    @Test
    void connectionFailureDoesNotClaimThatSqlWasExecuted() {
        prepare("MYSQL");
        doThrow(new SqlExecutionException(0, new SQLException("secret-jdbc-url")))
                .when(plugin).executeStatements(any(), anyList(), anyMap(), anyInt());
        assertThatThrownBy(() -> service.executePreSql("internal-token", request("MYSQL", List.of("SELECT 1"), null), Map.of()))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("前置 SQL连接失败", "传输未开始").hasMessageNotContaining("secret-jdbc-url");
    }

    @ParameterizedTest
    @ValueSource(strings = {"where", "fixed", "expression", "pre", "post"})
    void preSqlValidatesAllNodeParametersBeforeLookingUpPlugin(String missing) {
        prepare("MYSQL");
        TransferRenderRequest request = new TransferRenderRequest(4L,
                new TransferEndpointConfig(1L, "MYSQL", "source_db", "orders", "id = ^[where]", null, null, null),
                new TransferEndpointConfig(2L, "MYSQL", "selected_db", "orders", null, TransferWriteMode.APPEND,
                        List.of("delete from orders where id = ^[pre]"), List.of("insert into audit values (^[post])")),
                List.of(new TransferFieldMapping("id", TransferMappingKind.SOURCE_EXPRESSION, null, "^[expression]"),
                        new TransferFieldMapping("label", TransferMappingKind.STATIC_VALUE, null, null, "^[fixed]")), List.of());
        Map<String, String> parameters = new java.util.HashMap<>(Map.of(
                "where", "1", "fixed", "x", "expression", "2", "pre", "3", "post", "4"));
        parameters.remove(missing);

        assertThatThrownBy(() -> service.executePreSql("internal-token", request, parameters))
                .isInstanceOf(ResponseStatusException.class).hasMessageContaining("未提供的参数: " + missing)
                .extracting(e -> ((ResponseStatusException) e).getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        verifyNoInteractions(plugins, plugin);
    }

    @Test
    void emptyPreSqlStillRejectsMissingPostParameter() {
        prepare("MYSQL");
        assertThatThrownBy(() -> service.executePreSql("internal-token",
                request("MYSQL", List.of(), List.of("select ^[post]")), Map.of()))
                .isInstanceOf(ResponseStatusException.class).hasMessageContaining("未提供的参数: post");
        verifyNoInteractions(plugins, plugin);
    }

    @Test
    void emptyHiveHooksStillValidatePartitionParameters() {
        prepare("HIVE");
        TransferRenderRequest base = request("HIVE", null, null);
        TransferRenderRequest request = new TransferRenderRequest(base.groupId(), base.source(), base.target(),
                List.of(), List.of(new TransferPartitionMapping("dt", TransferMappingKind.STATIC_VALUE,
                        null, null, "^[partition]")));
        assertThatThrownBy(() -> service.executePreSql("internal-token", request, Map.of()))
                .isInstanceOf(ResponseStatusException.class).hasMessageContaining("未提供的参数: partition");
        verifyNoInteractions(plugins, plugin);
    }

    @ParameterizedTest
    @ValueSource(strings = {"MYSQL", "POSTGRESQL", "CLICKHOUSE"})
    void passesSameParameterMapAndUnrenderedStatementsToBothPhases(String type) {
        prepare(type);
        List<String> pre = List.of("delete from orders where id = ^[before]");
        List<String> post = List.of("insert into audit values (^[after], ^[before])");
        TransferRenderRequest request = request(type, pre, post);
        Map<String, String> parameters = Map.of("before", "O'Reilly\n$(touch injected) ^[after] 中文", "after", "done");

        service.executePreSql("internal-token", request, parameters);
        service.executePostSql("internal-token", request, parameters);

        verify(plugin).executeStatements(any(), same(pre), same(parameters), eq(17));
        verify(plugin).executeStatements(any(), same(post), same(parameters), eq(17));
    }

    private void prepare(String type) {
        when(metadata.requireSupportedDataSource(1L)).thenReturn(dataSource(1L, "MYSQL"));
        when(metadata.requireSupportedDataSource(2L)).thenReturn(dataSource(2L, type));
        when(plugins.getPlugin(type)).thenReturn(Optional.of(plugin));
    }

    private DataSource dataSource(Long id, String type) {
        DataSource dataSource = new DataSource();
        dataSource.setId(id);
        dataSource.setGroupId(4L);
        dataSource.setType(type);
        dataSource.setHost("localhost");
        dataSource.setPort(3306);
        dataSource.setDatabaseName("default_db");
        dataSource.setUsername("user");
        dataSource.setPassword("secret");
        dataSource.setConnectionParams(Map.of("jdbcParams", "test=true"));
        return dataSource;
    }

    private TransferRenderRequest request(String type, List<String> pre, List<String> post) {
        return new TransferRenderRequest(4L,
                new TransferEndpointConfig(1L, "MYSQL", "source_db", "orders", null, null, null, null),
                new TransferEndpointConfig(2L, type, "selected_db", "orders", null, TransferWriteMode.APPEND, pre, post),
                List.of(), List.of());
    }
}
