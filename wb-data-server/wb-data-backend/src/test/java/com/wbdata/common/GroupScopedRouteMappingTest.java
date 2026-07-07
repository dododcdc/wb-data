package com.wbdata.common;

import com.wbdata.datasource.controller.DataSourceController;
import com.wbdata.git.controller.GitConfigController;
import com.wbdata.git.controller.GitSyncConfigController;
import com.wbdata.group.controller.GroupSettingsController;
import com.wbdata.offline.controller.OfflineExecutionController;
import com.wbdata.offline.controller.OfflineFlowController;
import com.wbdata.offline.controller.OfflineRepoController;
import com.wbdata.offline.controller.OfflineScheduleController;
import com.wbdata.operations.controller.OperationsExecutionController;
import org.junit.jupiter.api.Test;
import org.springframework.web.bind.annotation.RequestMapping;

import static org.assertj.core.api.Assertions.assertThat;

class GroupScopedRouteMappingTest {

    @Test
    void projectGroupScopedControllersExposeGroupPathPrefix() {
        assertMapping(DataSourceController.class, "/api/v1/groups/{groupId}/datasources");
        assertMapping(GroupSettingsController.class, "/api/v1/groups/{groupId}/settings");
        assertMapping(GitConfigController.class, "/api/v1/groups/{groupId}/git/config");
        assertMapping(GitSyncConfigController.class, "/api/v1/groups/{groupId}/git/sync-config");
        assertMapping(OfflineRepoController.class, "/api/v1/groups/{groupId}/offline");
        assertMapping(OfflineFlowController.class, "/api/v1/groups/{groupId}/offline/flows");
        assertMapping(OfflineScheduleController.class, "/api/v1/groups/{groupId}/offline/schedules");
        assertMapping(OfflineExecutionController.class, "/api/v1/groups/{groupId}/offline/executions");
        assertMapping(OperationsExecutionController.class, "/api/v1/groups/{groupId}/operations/executions");
    }

    private void assertMapping(Class<?> controller, String expectedPath) {
        RequestMapping mapping = controller.getAnnotation(RequestMapping.class);
        assertThat(mapping.value()).contains(expectedPath);
    }
}
