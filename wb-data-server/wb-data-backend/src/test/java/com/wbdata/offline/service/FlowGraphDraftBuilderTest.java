package com.wbdata.offline.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.wbdata.datasource.entity.DataSource;
import com.wbdata.datasource.service.DataSourceService;
import com.wbdata.offline.dto.SaveOfflineFlowEdgeRequest;
import com.wbdata.offline.dto.SaveOfflineFlowNodeRequest;
import com.wbdata.offline.dto.SaveOfflineFlowStageRequest;
import com.wbdata.offline.transfer.service.TransferConfigFileService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class FlowGraphDraftBuilderTest {
    private final DataSourceService dataSourceService = mock(DataSourceService.class);
    private final FlowGraphDraftBuilder builder = new FlowGraphDraftBuilder(
            dataSourceService, new TransferConfigFileService(new ObjectMapper()));

    @ParameterizedTest
    @ValueSource(strings = {"SQL", "MYSQL", "POSTGRESQL", "CLICKHOUSE", "HIVE_SQL"})
    void prepareRejectsCrossGroupDataSourceAfterValidReference(String kind) {
        when(dataSourceService.getById(11L)).thenReturn(dataSource(11L, 1L));
        when(dataSourceService.getById(22L)).thenReturn(dataSource(22L, 2L));

        assertUnavailableDataSource(kind);
    }

    @ParameterizedTest
    @ValueSource(strings = {"SQL", "MYSQL", "POSTGRESQL", "CLICKHOUSE", "HIVE_SQL"})
    void prepareRejectsMissingDataSourceAfterValidReference(String kind) {
        when(dataSourceService.getById(11L)).thenReturn(dataSource(11L, 1L));

        assertUnavailableDataSource(kind);
    }

    @Test
    void prepareRejectsDataSourceWithoutGroup() {
        when(dataSourceService.getById(11L)).thenReturn(dataSource(11L, 1L));
        when(dataSourceService.getById(22L)).thenReturn(dataSource(22L, null));

        assertUnavailableDataSource("SQL");
    }

    private void assertUnavailableDataSource(String kind) {
        assertThatThrownBy(() -> builder.prepare(1L, "_flows/example/flow.yaml",
                List.of(
                        new SaveOfflineFlowStageRequest("first", List.of(node("local", "SQL", 11L))),
                        new SaveOfflineFlowStageRequest("second", List.of(node("other", kind, 22L)))
                ), List.of()))
                .isInstanceOfSatisfying(ResponseStatusException.class, ex -> {
                    assertThat(ex.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
                    assertThat(ex.getReason()).isEqualTo("数据源不存在");
                });
    }

    @Test
    void preparePreservesSameGroupDataSourcesScriptsAndEdges() throws Exception {
        DataSource mysql = dataSource(11L, 1L);
        DataSource hive = dataSource(22L, 1L);
        hive.setType("HIVE");
        when(dataSourceService.getById(11L)).thenReturn(mysql);
        when(dataSourceService.getById(22L)).thenReturn(hive);

        var draft = builder.prepare(1L, "_flows/example/flow.yaml",
                List.of(new SaveOfflineFlowStageRequest("main", List.of(
                        node("mysql", "SQL", 11L), node("hive", "HIVE_SQL", 22L)))),
                List.of(new SaveOfflineFlowEdgeRequest("mysql", "hive")));

        assertThat(draft.dataSourceMap()).containsExactlyInAnyOrderEntriesOf(Map.of(11L, mysql, 22L, hive));
        assertThat(draft.scriptFileContents()).isEqualTo(Map.of(
                "scripts/example/mysql.sql", "select 1", "scripts/example/hive.sql", "select 1"));
        assertThat(draft.namespaceFileContents()).isEqualTo(draft.scriptFileContents());
        assertThat(draft.edges()).containsExactly(new OfflineFlowYamlSupport.FlowEdge("mysql", "hive"));
        assertThat(draft.nodes()).extracting(OfflineFlowNode::kind).containsExactly("SQL", "HIVE_SQL");
    }

    private SaveOfflineFlowNodeRequest node(String taskId, String kind, Long dataSourceId) {
        return new SaveOfflineFlowNodeRequest(taskId, "select 1", kind,
                "scripts/example/" + taskId + ".sql", dataSourceId, "HIVE_SQL".equals(kind) ? "HIVE" : "MYSQL");
    }

    private DataSource dataSource(Long id, Long groupId) {
        DataSource dataSource = new DataSource();
        dataSource.setId(id);
        dataSource.setGroupId(groupId);
        dataSource.setType("MYSQL");
        dataSource.setPassword("private-password");
        return dataSource;
    }
}
