package com.wbdata.offline.service;

import com.wbdata.offline.repo.service.RepoLockManager;

import com.wbdata.offline.config.OfflineProperties;
import com.wbdata.offline.dto.SaveOfflineFlowRequest;
import com.wbdata.offline.schedule.dto.UpdateOfflineScheduleRequest;
import com.wbdata.offline.schedule.dto.UpdateOfflineScheduleStatusRequest;
import com.wbdata.offline.enums.OfflineSchedulePeriod;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.web.server.ResponseStatusException;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

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
                        labels:
                          wbdataRuntimeTimezone: Asia/Shanghai
                        tasks: []
                        """,
                null,
                0L
        ));

        var enabled = scheduleService.updateSchedule(new UpdateOfflineScheduleRequest(
                1L,
                "_flows/example/flow.yaml",
                "* * * * *",
                OfflineSchedulePeriod.CUSTOM,
                initial.contentHash(),
                initial.fileUpdatedAt()
        ));

        assertThat(enabled.enabled()).isTrue();
        assertThat(enabled.period()).isEqualTo(OfflineSchedulePeriod.CUSTOM);
        String enabledYaml = Files.readString(properties.resolveRepoPath(1L)
                .resolve(".wb-data/kestra-flows/example.yaml"));
        assertThat(enabledYaml)
                .contains("triggers:")
                .contains("type: io.kestra.plugin.core.trigger.Schedule")
                .contains("cron:")
                .contains("* * * * *")
                .contains("timezone: Asia/Shanghai")
                .contains("recoverMissedSchedules: NONE")
                .contains("wbdataSchedulePeriod: CUSTOM");

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

    @Test
    void getSchedule_infersPeriodFromCronWhenLabelMissing() {
        OfflineProperties properties = offlineProperties();
        RepoLockManager repoLockManager = new RepoLockManager();
        OfflineKestraFlowFileService kestraFlowFileService = new OfflineKestraFlowFileService(properties);
        OfflineFlowContentService contentService = new OfflineFlowContentService(
                properties,
                repoLockManager,
                kestraFlowFileService
        );
        OfflineScheduleService scheduleService = new OfflineScheduleService(contentService);

        contentService.saveFlowContent(new SaveOfflineFlowRequest(
                1L,
                "_flows/legacy/flow.yaml",
                """
                        id: legacy
                        namespace: pg-1
                        tasks: []
                        triggers:
                          - id: schedule
                            type: io.kestra.plugin.core.trigger.Schedule
                            cron: "0 2 * * *"
                            timezone: Asia/Shanghai
                        """,
                null,
                0L
        ));

        var schedule = scheduleService.getSchedule(1L, "_flows/legacy/flow.yaml");

        assertThat(schedule.period()).isEqualTo(OfflineSchedulePeriod.DAILY);
    }

    @Test
    void updateSchedule_supportsContinuousRangeStepAndDiscreteHourlyAndRejectsInvalidHourly() {
        OfflineProperties properties = offlineProperties();
        RepoLockManager repoLockManager = new RepoLockManager();
        OfflineFlowContentService contentService = new OfflineFlowContentService(
                properties, repoLockManager, new OfflineKestraFlowFileService(properties));
        OfflineScheduleService scheduleService = new OfflineScheduleService(contentService);

        var initial = contentService.saveFlowContent(new SaveOfflineFlowRequest(
                1L,
                "_flows/hourly/flow.yaml",
                """
                        id: hourly
                        namespace: pg-1
                        labels:
                          wbdataRuntimeTimezone: Asia/Shanghai
                        tasks: []
                        """,
                null,
                0L
        ));

        var rangeStep = scheduleService.updateSchedule(new UpdateOfflineScheduleRequest(
                1L, "_flows/hourly/flow.yaml", "15 8-22/2 * * *",
                OfflineSchedulePeriod.HOURLY, initial.contentHash(), initial.fileUpdatedAt()));
        assertThat(rangeStep.period()).isEqualTo(OfflineSchedulePeriod.HOURLY);
        assertThat(rangeStep.cron()).isEqualTo("15 8-22/2 * * *");

        var discrete = scheduleService.updateSchedule(new UpdateOfflineScheduleRequest(
                1L, "_flows/hourly/flow.yaml", "15 1,3,14 * * *",
                OfflineSchedulePeriod.HOURLY, rangeStep.contentHash(), rangeStep.fileUpdatedAt()));
        assertThat(discrete.period()).isEqualTo(OfflineSchedulePeriod.HOURLY);
        assertThat(discrete.cron()).isEqualTo("15 1,3,14 * * *");

        assertThatThrownBy(() -> scheduleService.updateSchedule(new UpdateOfflineScheduleRequest(
                1L, "_flows/hourly/flow.yaml", "0 14 * * *",
                OfflineSchedulePeriod.HOURLY, discrete.contentHash(), discrete.fileUpdatedAt())))
                .isInstanceOfSatisfying(ResponseStatusException.class,
                        ex -> assertThat(ex.getReason()).contains("小时调度 Cron 不合法"));

        assertThatThrownBy(() -> scheduleService.updateSchedule(new UpdateOfflineScheduleRequest(
                1L, "_flows/hourly/flow.yaml", "0 22-6 * * *",
                OfflineSchedulePeriod.HOURLY, discrete.contentHash(), discrete.fileUpdatedAt())))
                .isInstanceOfSatisfying(ResponseStatusException.class,
                        ex -> assertThat(ex.getReason()).contains("小时调度 Cron 不合法"));
    }

    @Test
    void updateSchedule_persistsRetrySettingsAndPreservesWhenOmitted() throws Exception {
        OfflineProperties properties = offlineProperties();
        RepoLockManager repoLockManager = new RepoLockManager();
        OfflineFlowContentService contentService = new OfflineFlowContentService(
                properties, repoLockManager, new OfflineKestraFlowFileService(properties));
        OfflineScheduleService scheduleService = new OfflineScheduleService(contentService);

        var initial = contentService.saveFlowContent(new SaveOfflineFlowRequest(
                1L,
                "_flows/retry/flow.yaml",
                """
                        id: retry
                        namespace: pg-1
                        labels:
                          wbdataRuntimeTimezone: Asia/Shanghai
                        tasks: []
                        """,
                null,
                0L
        ));

        var withRetry = scheduleService.updateSchedule(new UpdateOfflineScheduleRequest(
                1L, "_flows/retry/flow.yaml", "0 2 * * *", OfflineSchedulePeriod.DAILY,
                initial.contentHash(), initial.fileUpdatedAt(), true, 4, 15));
        assertThat(withRetry.retryEnabled()).isTrue();
        assertThat(withRetry.retryCount()).isEqualTo(4);
        assertThat(withRetry.retryIntervalMinutes()).isEqualTo(15);

        // Legacy 6-arg update without retry fields preserves existing retry config
        var timeUpdated = scheduleService.updateSchedule(new UpdateOfflineScheduleRequest(
                1L, "_flows/retry/flow.yaml", "30 3 * * *", OfflineSchedulePeriod.DAILY,
                withRetry.contentHash(), withRetry.fileUpdatedAt()));
        assertThat(timeUpdated.retryEnabled()).isTrue();
        assertThat(timeUpdated.retryCount()).isEqualTo(4);
        assertThat(timeUpdated.retryIntervalMinutes()).isEqualTo(15);

        var fetched = scheduleService.getSchedule(1L, "_flows/retry/flow.yaml");
        assertThat(fetched.retryEnabled()).isTrue();
        assertThat(fetched.retryCount()).isEqualTo(4);
        assertThat(fetched.retryIntervalMinutes()).isEqualTo(15);

        var disabledRetry = scheduleService.updateSchedule(new UpdateOfflineScheduleRequest(
                1L, "_flows/retry/flow.yaml", "30 3 * * *", OfflineSchedulePeriod.DAILY,
                timeUpdated.contentHash(), timeUpdated.fileUpdatedAt(), false, null, null));
        assertThat(disabledRetry.retryEnabled()).isFalse();
        assertThat(disabledRetry.retryCount()).isNull();
        assertThat(disabledRetry.retryIntervalMinutes()).isNull();
        String kestraYaml = Files.readString(properties.resolveRepoPath(1L)
                .resolve(".wb-data/kestra-flows/retry.yaml"));
        assertThat(kestraYaml).doesNotContain("retry:");
    }

    private OfflineProperties offlineProperties() {
        OfflineProperties properties = new OfflineProperties();
        properties.setRepoBaseDir(tempDir.toString());
        properties.setRepoDirPrefix("wb-data-");
        return properties;
    }
}
