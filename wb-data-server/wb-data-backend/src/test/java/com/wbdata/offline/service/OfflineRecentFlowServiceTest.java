package com.wbdata.offline.service;

import com.wbdata.offline.entity.WbOfflineRecentFlow;
import com.wbdata.offline.mapper.WbOfflineRecentFlowMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.io.Serializable;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.concurrent.atomic.AtomicLong;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class OfflineRecentFlowServiceTest {

    private final List<WbOfflineRecentFlow> store = new ArrayList<>();
    private final AtomicLong idGenerator = new AtomicLong(1L);
    private OfflineRecentFlowService service;

    @BeforeEach
    void setUp() {
        store.clear();
        idGenerator.set(1L);
        WbOfflineRecentFlowMapper mapper = createInMemoryMapper(store, idGenerator);
        service = new OfflineRecentFlowService(mapper);
    }

    static WbOfflineRecentFlowMapper createInMemoryMapper(List<WbOfflineRecentFlow> rows, AtomicLong idSeq) {
        WbOfflineRecentFlowMapper mapper = mock(WbOfflineRecentFlowMapper.class);
        Comparator<WbOfflineRecentFlow> order = Comparator
                .comparing(WbOfflineRecentFlow::getAccessedAt, Comparator.nullsLast(Comparator.reverseOrder()))
                .thenComparing(WbOfflineRecentFlow::getId, Comparator.nullsLast(Comparator.reverseOrder()));

        when(mapper.findByUserAndGroup(anyLong(), anyLong())).thenAnswer(invocation -> {
            Long userId = invocation.getArgument(0);
            Long groupId = invocation.getArgument(1);
            return rows.stream()
                    .filter(row -> userId.equals(row.getUserId()) && groupId.equals(row.getGroupId()))
                    .sorted(order)
                    .toList();
        });
        when(mapper.findByGroup(anyLong())).thenAnswer(invocation -> {
            Long groupId = invocation.getArgument(0);
            return rows.stream()
                    .filter(row -> groupId.equals(row.getGroupId()))
                    .sorted(order)
                    .toList();
        });
        when(mapper.deleteByUserGroupAndPath(anyLong(), anyLong(), anyString())).thenAnswer(invocation -> {
            Long userId = invocation.getArgument(0);
            Long groupId = invocation.getArgument(1);
            String path = invocation.getArgument(2);
            boolean removed = rows.removeIf(row -> userId.equals(row.getUserId())
                    && groupId.equals(row.getGroupId())
                    && path.equals(row.getFlowPath()));
            return removed ? 1 : 0;
        });
        when(mapper.deleteByGroupAndPath(anyLong(), anyString())).thenAnswer(invocation -> {
            Long groupId = invocation.getArgument(0);
            String path = invocation.getArgument(1);
            int before = rows.size();
            rows.removeIf(row -> groupId.equals(row.getGroupId()) && path.equals(row.getFlowPath()));
            return before - rows.size();
        });
        when(mapper.insert(any(WbOfflineRecentFlow.class))).thenAnswer(invocation -> {
            WbOfflineRecentFlow entity = invocation.getArgument(0);
            WbOfflineRecentFlow copy = new WbOfflineRecentFlow();
            copy.setId(idSeq.getAndIncrement());
            copy.setUserId(entity.getUserId());
            copy.setGroupId(entity.getGroupId());
            copy.setFlowPath(entity.getFlowPath());
            copy.setAccessedAt(entity.getAccessedAt());
            rows.add(copy);
            entity.setId(copy.getId());
            return 1;
        });
        when(mapper.deleteById(any(Serializable.class))).thenAnswer(invocation -> {
            Object id = invocation.getArgument(0);
            boolean removed = rows.removeIf(row -> id.equals(row.getId()));
            return removed ? 1 : 0;
        });
        when(mapper.updateFlowPathById(anyLong(), anyString())).thenAnswer(invocation -> {
            Long id = invocation.getArgument(0);
            String nextPath = invocation.getArgument(1);
            for (WbOfflineRecentFlow row : rows) {
                if (id.equals(row.getId())) {
                    row.setFlowPath(nextPath);
                    return 1;
                }
            }
            return 0;
        });
        return mapper;
    }

    @Test
    void recordsRecentFlowsInLruOrderCappedAtFivePerUserAndGroup() {
        for (int index = 1; index <= 6; index++) {
            service.recordRecentFlow(10L, 1L, "_flows/task-" + index + "/flow.yaml");
        }
        service.recordRecentFlow(20L, 1L, "_flows/other-user/flow.yaml");
        service.recordRecentFlow(10L, 2L, "_flows/other-group/flow.yaml");

        assertThat(service.listRecentFlowPaths(10L, 1L)).containsExactly(
                "_flows/task-6/flow.yaml",
                "_flows/task-5/flow.yaml",
                "_flows/task-4/flow.yaml",
                "_flows/task-3/flow.yaml",
                "_flows/task-2/flow.yaml"
        );

        service.recordRecentFlow(10L, 1L, "_flows/task-3/flow.yaml");
        assertThat(service.listRecentFlowPaths(10L, 1L)).containsExactly(
                "_flows/task-3/flow.yaml",
                "_flows/task-6/flow.yaml",
                "_flows/task-5/flow.yaml",
                "_flows/task-4/flow.yaml",
                "_flows/task-2/flow.yaml"
        );
        assertThat(service.listRecentFlowPaths(20L, 1L)).containsExactly("_flows/other-user/flow.yaml");
        assertThat(service.listRecentFlowPaths(10L, 2L)).containsExactly("_flows/other-group/flow.yaml");
    }

    @Test
    void syncsRecentFlowPathsAcrossFlowAndFolderMoveAndDelete() {
        service.recordRecentFlow(10L, 1L, "_flows/dir/a/flow.yaml");
        service.recordRecentFlow(10L, 1L, "_flows/dir/nested/b/flow.yaml");
        service.recordRecentFlow(10L, 1L, "_flows/keep/flow.yaml");
        service.recordRecentFlow(20L, 1L, "_flows/dir/a/flow.yaml");

        service.onFlowMoved(1L, "_flows/dir/a/flow.yaml", "_flows/dir/a-renamed/flow.yaml");
        assertThat(service.listRecentFlowPaths(10L, 1L)).containsExactly(
                "_flows/keep/flow.yaml",
                "_flows/dir/nested/b/flow.yaml",
                "_flows/dir/a-renamed/flow.yaml"
        );
        assertThat(service.listRecentFlowPaths(20L, 1L)).containsExactly("_flows/dir/a-renamed/flow.yaml");

        service.onFolderMoved(1L, "_flows/dir", "_flows/archive/dir-v2");
        assertThat(service.listRecentFlowPaths(10L, 1L)).containsExactly(
                "_flows/keep/flow.yaml",
                "_flows/archive/dir-v2/nested/b/flow.yaml",
                "_flows/archive/dir-v2/a-renamed/flow.yaml"
        );

        service.onFlowDeleted(1L, "_flows/archive/dir-v2/a-renamed/flow.yaml");
        assertThat(service.listRecentFlowPaths(10L, 1L)).containsExactly(
                "_flows/keep/flow.yaml",
                "_flows/archive/dir-v2/nested/b/flow.yaml"
        );
        assertThat(service.listRecentFlowPaths(20L, 1L)).isEmpty();

        service.onFolderDeleted(1L, "_flows/archive");
        assertThat(service.listRecentFlowPaths(10L, 1L)).containsExactly("_flows/keep/flow.yaml");
    }
}
