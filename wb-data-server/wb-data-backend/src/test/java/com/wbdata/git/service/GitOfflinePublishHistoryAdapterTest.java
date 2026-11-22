package com.wbdata.git.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.wbdata.git.entity.WbGitSyncConfig;
import com.wbdata.git.entity.WbOfflinePublishRecord;
import com.wbdata.git.mapper.WbGitSyncConfigMapper;
import com.wbdata.git.mapper.WbOfflinePublishRecordMapper;
import com.wbdata.offline.repo.service.OfflinePublishHistoryPort;
import org.junit.jupiter.api.Test;

import java.time.LocalDateTime;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class GitOfflinePublishHistoryAdapterTest {

    private final OfflinePublishRecordService publishRecordService = mock(OfflinePublishRecordService.class);
    private final WbOfflinePublishRecordMapper publishRecordMapper = mock(WbOfflinePublishRecordMapper.class);
    private final WbGitSyncConfigMapper syncConfigMapper = mock(WbGitSyncConfigMapper.class);
    private final GitOfflinePublishHistoryAdapter adapter = new GitOfflinePublishHistoryAdapter(
            publishRecordService, publishRecordMapper, syncConfigMapper);

    @Test
    void recordPushDelegatesAndReturnsRecordId() {
        WbOfflinePublishRecord record = new WbOfflinePublishRecord();
        record.setId(88L);
        when(publishRecordService.recordPush(4L, 9L, "main", "sha1", "sha2")).thenReturn(record);

        Long id = adapter.recordPush(4L, 9L, "main", "sha1", "sha2");

        assertThat(id).isEqualTo(88L);
    }

    @Test
    void loadBranchPublishHistoryMapsSyncStateAndRecords() {
        WbGitSyncConfig syncConfig = new WbGitSyncConfig();
        syncConfig.setDeploymentEvidence("CONFIRMED");
        syncConfig.setLastDeployedSha("sha2");
        when(syncConfigMapper.selectOne(any(LambdaQueryWrapper.class))).thenReturn(syncConfig);

        WbOfflinePublishRecord entry = new WbOfflinePublishRecord();
        entry.setId(11L);
        entry.setBeforeSha("sha1");
        entry.setAfterSha("sha2");
        LocalDateTime pushedAt = LocalDateTime.of(2026, 11, 22, 10, 0);
        entry.setPushedAt(pushedAt);
        entry.setSyncStatus("SUCCESS");
        when(publishRecordMapper.selectList(any(LambdaQueryWrapper.class))).thenReturn(List.of(entry));

        OfflinePublishHistoryPort.BranchPublishHistory history = adapter.loadBranchPublishHistory(4L, "main");

        assertThat(history.deploymentState())
                .isEqualTo(new OfflinePublishHistoryPort.SyncDeploymentState("CONFIRMED", "sha2"));
        assertThat(history.records())
                .containsExactly(new OfflinePublishHistoryPort.PublishEntry(
                        11L, "sha1", "sha2", pushedAt, "SUCCESS"));
    }
}
