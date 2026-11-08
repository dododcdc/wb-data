package com.wbdata.git.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.wbdata.git.entity.WbGitSyncConfig;
import com.wbdata.git.entity.WbOfflinePublishRecord;
import com.wbdata.git.mapper.WbGitSyncConfigMapper;
import com.wbdata.git.mapper.WbOfflinePublishRecordMapper;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class OfflinePublishRecordServiceTest {

    private final WbOfflinePublishRecordMapper publishMapper = Mockito.mock(WbOfflinePublishRecordMapper.class);
    private final WbGitSyncConfigMapper syncConfigMapper = Mockito.mock(WbGitSyncConfigMapper.class);
    private final OfflinePublishRecordService service = new OfflinePublishRecordService(publishMapper, syncConfigMapper);

    @Test
    void recordPushCapturesOperatorRangeAndSyncIntent() {
        WbGitSyncConfig syncConfig = new WbGitSyncConfig();
        syncConfig.setEnabled(true);
        when(syncConfigMapper.selectOne(any(LambdaQueryWrapper.class))).thenReturn(syncConfig);

        WbOfflinePublishRecord record = service.recordPush(4L, 9L, "main", "before", "after");

        ArgumentCaptor<WbOfflinePublishRecord> captor = ArgumentCaptor.forClass(WbOfflinePublishRecord.class);
        verify(publishMapper).insert(captor.capture());
        WbOfflinePublishRecord saved = captor.getValue();
        assertThat(saved.getRecordType()).isEqualTo("PUSH");
        assertThat(saved.getGroupId()).isEqualTo(4L);
        assertThat(saved.getPushedBy()).isEqualTo(9L);
        assertThat(saved.getBeforeSha()).isEqualTo("before");
        assertThat(saved.getAfterSha()).isEqualTo("after");
        assertThat(saved.getSyncEnabledAtPush()).isTrue();
        assertThat(saved.getSyncStatus()).isEqualTo("PENDING");
        assertThat(saved.getPushedAt()).isNotNull();
        assertThat(record).isSameAs(saved);
    }

    @Test
    void recordPushWithoutSyncConfigOnlyMarksPushed() {
        when(syncConfigMapper.selectOne(any(LambdaQueryWrapper.class))).thenReturn(null);

        service.recordPush(4L, 9L, "feature/test", null, "after");

        ArgumentCaptor<WbOfflinePublishRecord> captor = ArgumentCaptor.forClass(WbOfflinePublishRecord.class);
        verify(publishMapper).insert(captor.capture());
        assertThat(captor.getValue().getSyncEnabledAtPush()).isFalse();
        assertThat(captor.getValue().getSyncStatus()).isEqualTo("NONE");
    }

    @Test
    void recordBaselineStartsUnknownAndSkipsExistingRevision() {
        when(publishMapper.selectCount(any(LambdaQueryWrapper.class))).thenReturn(0L);

        service.recordBaseline(4L, "main", "after");

        ArgumentCaptor<WbOfflinePublishRecord> captor = ArgumentCaptor.forClass(WbOfflinePublishRecord.class);
        verify(publishMapper).insert(captor.capture());
        assertThat(captor.getValue().getRecordType()).isEqualTo("BASELINE");
        assertThat(captor.getValue().getSyncStatus()).isEqualTo("UNKNOWN");
        assertThat(captor.getValue().getPushedAt()).isNull();
        assertThat(captor.getValue().getPushedBy()).isNull();

        when(publishMapper.selectCount(any(LambdaQueryWrapper.class))).thenReturn(1L);
        service.recordBaseline(4L, "main", "after");
        verify(publishMapper).insert(any(WbOfflinePublishRecord.class));
    }

    @Test
    void markSyncExecutionMapsTerminalAndRunningStates() {
        WbOfflinePublishRecord record = new WbOfflinePublishRecord();
        record.setId(7L);
        when(publishMapper.selectById(7L)).thenReturn(record);

        service.markSyncExecution(7L, "execution-1", "QUEUED");
        assertThat(record.getSyncStatus()).isEqualTo("RUNNING");
        assertThat(record.getSyncExecutionId()).isEqualTo("execution-1");

        service.markSyncExecution(7L, "execution-1", "FAILED");
        assertThat(record.getSyncStatus()).isEqualTo("FAILED");
    }
}
