package com.wbdata.git.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.wbdata.git.entity.WbGitSyncConfig;
import com.wbdata.git.entity.WbOfflinePublishRecord;
import com.wbdata.git.mapper.WbGitSyncConfigMapper;
import com.wbdata.git.mapper.WbOfflinePublishRecordMapper;
import com.wbdata.offline.kestra.KestraClient;
import com.wbdata.offline.kestra.KestraExecutionSnapshot;
import com.wbdata.offline.repo.service.GitCommandService;
import com.wbdata.offline.service.OfflineFlowInspector;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Set;

@Slf4j
@Service
@RequiredArgsConstructor
public class GitSyncExecutionReconciliationService {

    private static final Set<String> TERMINAL_STATES = Set.of("SUCCESS", "FAILED", "KILLED", "CANCELLED", "WARNING");

    private final WbGitSyncConfigMapper syncConfigMapper;
    private final WbOfflinePublishRecordMapper publishRecordMapper;
    private final OfflinePublishRecordService publishRecordService;
    private final GitCommandService gitCommandService;
    private final KestraClient kestraClient;
    private final OfflineFlowInspector flowInspector = new OfflineFlowInspector();

    @Scheduled(initialDelayString = "PT15S", fixedDelayString = "PT30S")
    public void reconcile() {
        reconcilePublishRecords();
        List<WbGitSyncConfig> configs = syncConfigMapper.selectList(new LambdaQueryWrapper<WbGitSyncConfig>());
        for (WbGitSyncConfig config : configs) {
            try {
                var executions = kestraClient.searchExecutions(Map.of(
                        "filters[namespace][EQUALS]", GitSyncFlowSourceBuilder.SYSTEM_NAMESPACE,
                        "filters[flowId][EQUALS]", GitSyncFlowSourceBuilder.buildSyncFlowId(
                                config.getGroupId(), config.getBranch())));
                if (executions.isEmpty()) {
                    reconcileMissingExecution(config);
                } else {
                    executions.stream()
                            .max(Comparator.comparing(this::executionTime))
                            .ifPresent(execution -> reconcileExecution(config, execution));
                }
            } catch (RuntimeException ex) {
                log.warn("同步执行对账失败: groupId={}, branch={}, message={}",
                        config.getGroupId(), config.getBranch(), ex.getMessage());
            }
        }
    }

    private void reconcilePublishRecords() {
        List<WbOfflinePublishRecord> pending = publishRecordMapper.selectList(new LambdaQueryWrapper<WbOfflinePublishRecord>()
                .isNotNull(WbOfflinePublishRecord::getSyncExecutionId)
                .in(WbOfflinePublishRecord::getSyncStatus, "PENDING", "RUNNING"));
        for (WbOfflinePublishRecord record : pending) {
            try {
                KestraExecutionSnapshot execution = kestraClient.getExecution(record.getSyncExecutionId());
                publishRecordService.markSyncExecution(record.getId(), execution.id(), execution.status());
            } catch (RuntimeException ex) {
                log.warn("推送同步状态回填失败: publishRecordId={}, message={}", record.getId(), ex.getMessage());
            }
        }
    }

    void reconcileMissingExecution(WbGitSyncConfig config) {
        if (config.getLastSyncAt() == null || config.getLastSyncMessage() == null
                || config.getLastSyncMessage().isBlank()
                || TERMINAL_STATES.contains(config.getLastSyncStatus())
                || config.getLastSyncAt().isAfter(LocalDateTime.now().minusMinutes(2))) {
            return;
        }
        config.setLastSyncStatus("UNKNOWN");
        config.setDeploymentEvidence("UNKNOWN");
        config.setLastEvidenceAt(LocalDateTime.now());
        syncConfigMapper.updateById(config);
    }

    void reconcileExecution(WbGitSyncConfig config, KestraExecutionSnapshot execution) {
        config.setLastSyncAt(toLocalDateTime(execution.createdAt()));
        config.setLastSyncStatus(execution.status());
        config.setLastSyncMessage(execution.id());
        if (!TERMINAL_STATES.contains(execution.status())) {
            syncConfigMapper.updateById(config);
            return;
        }
        if (execution.startDate() == null) {
            syncConfigMapper.updateById(config);
            return;
        }

        LocalDateTime evidenceAt = toLocalDateTime(execution.endDate());
        LocalDateTime previousEvidenceAt = config.getLastEvidenceAt();
        if (previousEvidenceAt != null && !evidenceAt.isAfter(previousEvidenceAt)) {
            return;
        }

        boolean confirmed = "SUCCESS".equals(execution.status()) && hasMatchingRevisionOutputs(execution)
                && !hasIdentifierCollision(config)
                && verifyDeployedSources(config, execution.outputs().get("end_sha"));
        config.setLastEvidenceAt(evidenceAt);
        if (confirmed) {
            config.setLastDeployedSha(execution.outputs().get("end_sha"));
            config.setLastDeployedAt(evidenceAt);
            config.setDeploymentEvidence("CONFIRMED");
        } else {
            config.setDeploymentEvidence("UNKNOWN");
        }

        LambdaUpdateWrapper<WbGitSyncConfig> condition = new LambdaUpdateWrapper<WbGitSyncConfig>()
                .eq(WbGitSyncConfig::getId, config.getId());
        if (previousEvidenceAt == null) {
            condition.isNull(WbGitSyncConfig::getLastEvidenceAt);
        } else {
            condition.eq(WbGitSyncConfig::getLastEvidenceAt, previousEvidenceAt);
        }
        syncConfigMapper.update(config, condition);
    }

    private boolean hasMatchingRevisionOutputs(KestraExecutionSnapshot execution) {
        String startSha = execution.outputs().get("start_sha");
        String endSha = execution.outputs().get("end_sha");
        return startSha != null && !startSha.isBlank() && startSha.equals(endSha);
    }

    private boolean hasIdentifierCollision(WbGitSyncConfig config) {
        String namespace = GitSyncFlowSourceBuilder.buildKestraNamespace(config.getGroupId(), config.getBranch());
        String syncFlowId = GitSyncFlowSourceBuilder.buildSyncFlowId(config.getGroupId(), config.getBranch());
        return syncConfigMapper.selectList(new LambdaQueryWrapper<WbGitSyncConfig>()
                        .eq(WbGitSyncConfig::getGroupId, config.getGroupId()))
                .stream()
                .filter(other -> !other.getId().equals(config.getId()))
                .anyMatch(other -> namespace.equals(GitSyncFlowSourceBuilder.buildKestraNamespace(
                                config.getGroupId(), other.getBranch()))
                        || syncFlowId.equals(GitSyncFlowSourceBuilder.buildSyncFlowId(
                                config.getGroupId(), other.getBranch())));
    }

    private boolean verifyDeployedSources(WbGitSyncConfig config, String revision) {
        try {
            String namespace = GitSyncFlowSourceBuilder.buildKestraNamespace(config.getGroupId(), config.getBranch());
            for (String path : gitCommandService.listFlowFilesAtRevision(config.getGroupId(), revision)) {
                String expected = gitCommandService.readFlowFileAtRevision(config.getGroupId(), revision, path);
                String flowId = flowInspector.parseIdentity(expected).flowId();
                String actual = kestraClient.getFlowSource(namespace, flowId);
                if (!normalizeNamespace(expected, namespace).equals(normalizeNamespace(actual, namespace))) {
                    return false;
                }
            }
            return true;
        } catch (RuntimeException ex) {
            log.warn("部署内容校验失败: groupId={}, branch={}, revision={}, message={}",
                    config.getGroupId(), config.getBranch(), revision, ex.getMessage());
            return false;
        }
    }

    private String normalizeNamespace(String source, String namespace) {
        return source.replaceFirst("(?m)^namespace:\\s*.*$", "namespace: " + namespace).trim();
    }

    private Instant executionTime(KestraExecutionSnapshot execution) {
        if (execution.createdAt() != null) {
            return execution.createdAt();
        }
        if (execution.startDate() != null) {
            return execution.startDate();
        }
        if (execution.endDate() != null) {
            return execution.endDate();
        }
        return Instant.EPOCH;
    }

    private LocalDateTime toLocalDateTime(Instant instant) {
        return instant == null ? LocalDateTime.now() : LocalDateTime.ofInstant(instant, ZoneId.systemDefault());
    }
}
