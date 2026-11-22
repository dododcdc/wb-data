package com.wbdata.offline.repo.service;

import java.time.LocalDateTime;
import java.util.List;

/**
 * offline 域对发布记录与同步部署状态的窄端口：隔离 git 持久层与同步状态实体，
 * 由 git 包的 GitOfflinePublishHistoryAdapter 实现。
 */
public interface OfflinePublishHistoryPort {

    record SyncDeploymentState(String deploymentEvidence, String lastDeployedSha) {}

    record PublishEntry(Long id, String beforeSha, String afterSha, LocalDateTime pushedAt, String syncStatus) {}

    record BranchPublishHistory(SyncDeploymentState deploymentState, List<PublishEntry> records) {}

    /** 记录一次成功推送并返回发布记录 ID */
    Long recordPush(Long groupId, Long pushedBy, String branch, String beforeSha, String afterSha);

    /** 查询指定项目组和分支的同步部署状态及已启用同步的推送记录 */
    BranchPublishHistory loadBranchPublishHistory(Long groupId, String branch);
}
