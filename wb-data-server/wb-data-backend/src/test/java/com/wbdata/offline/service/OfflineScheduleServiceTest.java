package com.wbdata.offline.service;

import com.wbdata.offline.config.OfflineProperties;
import com.wbdata.offline.dto.SaveOfflineFlowRequest;
import com.wbdata.offline.dto.UpdateOfflineScheduleRequest;
import com.wbdata.offline.dto.UpdateOfflineScheduleStatusRequest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.assertj.core.api.Assertions.assertThat;

class OfflineScheduleServiceTest {

    @TempDir
    Path tempDir;

    @Test
    void updateSchedule_refreshesKestraSyncFile() throws Exception {
        OfflineProperties properties = offlineProperties();
        RepoLockManager repoLockManager = new RepoLockManager();
        OfflineKestraFlowFileService kestraFlowFileService = new OfflineKestraFlowFileService(properties);
        OfflineFlowContentService contentService = new OfflineFlowContentService(
                properties,
                repoLockManager,
                kestraFlowFileService
        );
        OfflineScheduleService scheduleService = new OfflineScheduleService(contentService);

        var initial = contentService.saveFlowContent(new SaveOfflineFlowRequest(
                1L,
                "_flows/example/flow.yaml",
                """
                        id: example
                        namespace: pg-1
                        tasks: []
                        """,
                null,
                0L
        ));

        var enabled = scheduleService.updateSchedule(new UpdateOfflineScheduleRequest(
                1L,
                "_flows/example/flow.yaml",
                "* * * * *",
                "Asia/Singapore",
                initial.contentHash(),
                initial.fileUpdatedAt()
        ));

        assertThat(enabled.enabled()).isTrue();
        String enabledYaml = Files.readString(properties.resolveRepoPath(1L)
                .resolve(".wb-data/kestra-flows/example.yaml"));
        assertThat(enabledYaml)
                .contains("triggers:")
                .contains("type: io.kestra.plugin.core.trigger.Schedule")
                .contains("cron:")
                .contains("* * * * *")
                .contains("timezone: Asia/Singapore")
                .contains("recoverMissedSchedules: NONE");

        var disabled = scheduleService.updateScheduleStatus(new UpdateOfflineScheduleStatusRequest(
                1L,
                "_flows/example/flow.yaml",
                false,
                enabled.contentHash(),
                enabled.fileUpdatedAt()
        ));

        assertThat(disabled.enabled()).isFalse();
        String disabledYaml = Files.readString(properties.resolveRepoPath(1L)
                .resolve(".wb-data/kestra-flows/example.yaml"));
        assertThat(disabledYaml).contains("disabled: true");
    }

    private OfflineProperties offlineProperties() {
        OfflineProperties properties = new OfflineProperties();
        properties.setRepoBaseDir(tempDir.toString());
        properties.setRepoDirPrefix("wb-data-");
        return properties;
    }
}
