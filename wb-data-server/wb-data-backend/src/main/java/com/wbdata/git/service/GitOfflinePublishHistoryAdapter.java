package com.wbdata.git.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.wbdata.git.entity.WbGitSyncConfig;
import com.wbdata.git.entity.WbOfflinePublishRecord;
import com.wbdata.git.mapper.WbGitSyncConfigMapper;
import com.wbdata.git.mapper.WbOfflinePublishRecordMapper;
import com.wbdata.offline.repo.service.OfflinePublishHistoryPort;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * offline 域发布历史端口的适配器：将推送记录写入与分支同步状态查询桥接到 git 模块。
 */
@Service
@RequiredArgsConstructor
public class GitOfflinePublishHistoryAdapter implements OfflinePublishHistoryPort {

    private final OfflinePublishRecordService publishRecordService;
    private final WbOfflinePublishRecordMapper publishRecordMapper;
    private final WbGitSyncConfigMapper syncConfigMapper;

    @Override
    public Long recordPush(Long groupId, Long pushedBy, String branch, String beforeSha, String afterSha) {
        WbOfflinePublishRecord record = publishRecordService.recordPush(groupId, pushedBy, branch, beforeSha, afterSha);
        return record.getId();
    }

    @Override
    public BranchPublishHistory loadBranchPublishHistory(Long groupId, String branch) {
        WbGitSyncConfig syncConfig = syncConfigMapper.selectOne(new LambdaQueryWrapper<WbGitSyncConfig>()
                .eq(WbGitSyncConfig::getGroupId, groupId)
                .eq(WbGitSyncConfig::getBranch, branch));
        SyncDeploymentState deploymentState = syncConfig == null
                ? null
                : new SyncDeploymentState(syncConfig.getDeploymentEvidence(), syncConfig.getLastDeployedSha());

        List<WbOfflinePublishRecord> records = publishRecordMapper.selectList(
                new LambdaQueryWrapper<WbOfflinePublishRecord>()
                        .eq(WbOfflinePublishRecord::getGroupId, groupId)
                        .eq(WbOfflinePublishRecord::getBranch, branch)
                        .eq(WbOfflinePublishRecord::getSyncEnabledAtPush, true)
                        .orderByAsc(WbOfflinePublishRecord::getPushedAt)
                        .orderByAsc(WbOfflinePublishRecord::getCreatedAt)
                        .orderByAsc(WbOfflinePublishRecord::getId));

        List<PublishEntry> entries = records.stream()
                .map(record -> new PublishEntry(
                        record.getId(),
                        record.getBeforeSha(),
                        record.getAfterSha(),
                        record.getPushedAt(),
                        record.getSyncStatus()))
                .toList();

        return new BranchPublishHistory(deploymentState, entries);
    }
}
