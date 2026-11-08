package com.wbdata.git.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.wbdata.git.entity.WbGitSyncConfig;
import com.wbdata.git.entity.WbOfflinePublishRecord;
import com.wbdata.git.mapper.WbGitSyncConfigMapper;
import com.wbdata.git.mapper.WbOfflinePublishRecordMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;

@Service
@RequiredArgsConstructor
public class OfflinePublishRecordService {

    private final WbOfflinePublishRecordMapper publishRecordMapper;
    private final WbGitSyncConfigMapper syncConfigMapper;

    public WbOfflinePublishRecord recordPush(Long groupId, Long pushedBy, String branch, String beforeSha, String afterSha) {
        WbGitSyncConfig syncConfig = syncConfigMapper.selectOne(new LambdaQueryWrapper<WbGitSyncConfig>()
                .eq(WbGitSyncConfig::getGroupId, groupId)
                .eq(WbGitSyncConfig::getBranch, branch));
        boolean syncEnabled = syncConfig != null && Boolean.TRUE.equals(syncConfig.getEnabled());

        WbOfflinePublishRecord record = new WbOfflinePublishRecord();
        record.setGroupId(groupId);
        record.setBranch(branch);
        record.setRecordType("PUSH");
        record.setBeforeSha(beforeSha);
        record.setAfterSha(afterSha);
        record.setPushedBy(pushedBy);
        record.setPushedAt(LocalDateTime.now());
        record.setSyncEnabledAtPush(syncEnabled);
        record.setSyncStatus(syncEnabled ? "PENDING" : "NONE");
        publishRecordMapper.insert(record);
        return record;
    }

    public void recordBaseline(Long groupId, String branch, String afterSha) {
        Long existing = publishRecordMapper.selectCount(new LambdaQueryWrapper<WbOfflinePublishRecord>()
                .eq(WbOfflinePublishRecord::getGroupId, groupId)
                .eq(WbOfflinePublishRecord::getBranch, branch)
                .eq(WbOfflinePublishRecord::getAfterSha, afterSha));
        if (existing != null && existing > 0) {
            return;
        }
        WbOfflinePublishRecord record = new WbOfflinePublishRecord();
        record.setGroupId(groupId);
        record.setBranch(branch);
        record.setRecordType("BASELINE");
        record.setAfterSha(afterSha);
        record.setSyncEnabledAtPush(true);
        record.setSyncStatus("UNKNOWN");
        publishRecordMapper.insert(record);
    }

    public void markSyncExecution(Long recordId, String executionId, String executionStatus) {
        if (recordId == null) {
            return;
        }
        WbOfflinePublishRecord record = publishRecordMapper.selectById(recordId);
        if (record == null) {
            return;
        }
        record.setSyncExecutionId(executionId);
        record.setSyncStatus(switch (executionStatus) {
            case "SUCCESS" -> "SUCCESS";
            case "FAILED", "KILLED", "CANCELLED", "WARNING" -> "FAILED";
            default -> "RUNNING";
        });
        publishRecordMapper.updateById(record);
    }

    public void markSyncTriggerFailed(Long recordId, String message) {
        if (recordId == null) {
            return;
        }
        WbOfflinePublishRecord record = publishRecordMapper.selectById(recordId);
        if (record == null) {
            return;
        }
        record.setSyncStatus("FAILED");
        record.setSyncMessage(message);
        publishRecordMapper.updateById(record);
    }
}
