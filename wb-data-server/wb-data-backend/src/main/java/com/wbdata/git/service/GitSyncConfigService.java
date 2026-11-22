package com.wbdata.git.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.wbdata.git.dto.AddAllGitSyncConfigsResponse;
import com.wbdata.git.dto.GitSyncConfigListResponse;
import com.wbdata.git.dto.GitSyncConfigResponse;
import com.wbdata.git.dto.TriggerGitSyncResponse;
import com.wbdata.git.entity.WbGitConfig;
import com.wbdata.git.entity.WbGitSyncConfig;
import com.wbdata.git.mapper.WbGitSyncConfigMapper;
import com.wbdata.offline.config.OfflineKestraProperties;
import com.wbdata.offline.repo.service.GitCommandService;
import com.wbdata.offline.repo.service.GitRepoPushedEvent;
import com.wbdata.offline.kestra.KestraClient;
import com.wbdata.offline.kestra.KestraExecutionSnapshot;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.event.EventListener;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.time.LocalDateTime;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;

@Slf4j
@Service
@RequiredArgsConstructor
public class GitSyncConfigService {
    private static final String SYSTEM_NAMESPACE = GitSyncFlowSourceBuilder.SYSTEM_NAMESPACE;

    private final WbGitSyncConfigMapper syncConfigMapper;
    private final OfflinePublishRecordService publishRecordService;
    private final GitConfigService gitConfigService;
    private final GitCommandService gitCommandService;
    private final KestraClient kestraClient;
    private final OfflineKestraProperties kestraProperties;
    private final GitSyncProperties syncProperties;

    public GitSyncConfigListResponse list(Long groupId) {
        List<WbGitSyncConfig> configs = syncConfigMapper.selectList(groupQuery(groupId));
        return new GitSyncConfigListResponse(
                configs.stream().map(this::toResponse).toList(),
                knownBranches(groupId).stream().toList(),
                syncProperties.getSyncCron()
        );
    }

    public List<GitSyncConfigResponse> listEnabledSyncConfigs(Long groupId) {
        return syncConfigMapper.selectList(new LambdaQueryWrapper<WbGitSyncConfig>()
                        .eq(WbGitSyncConfig::getGroupId, groupId)
                        .eq(WbGitSyncConfig::getEnabled, true)
                        .orderByAsc(WbGitSyncConfig::getBranch))
                .stream()
                .map(this::toResponse)
                .toList();
    }

    public GitSyncConfigResponse create(Long groupId, String branch) {
        WbGitConfig gitConfig = gitConfigService.requireDecryptedConfig(groupId);
        String normalizedBranch = normalizeBranch(branch);
        ensureKnownBranch(groupId, normalizedBranch);

        WbGitSyncConfig existing = syncConfigMapper.selectOne(groupBranchQuery(groupId, normalizedBranch));
        if (existing != null) {
            existing.setGitConfigId(gitConfig.getId());
            upsertSyncFlow(existing, gitConfig);
            syncConfigMapper.updateById(existing);
            return toResponse(existing);
        }

        ensureNoIdentifierCollision(groupId, normalizedBranch, syncConfigMapper.selectList(groupQuery(groupId)));
        WbGitSyncConfig config = new WbGitSyncConfig();
        config.setGroupId(groupId);
        config.setGitConfigId(gitConfig.getId());
        config.setBranch(normalizedBranch);
        config.setEnabled(true);
        upsertSyncFlow(config, gitConfig);
        syncConfigMapper.insert(config);
        return toResponse(config);
    }

    public AddAllGitSyncConfigsResponse createAllKnownBranches(Long groupId) {
        WbGitConfig gitConfig = gitConfigService.requireDecryptedConfig(groupId);
        Set<String> branches = knownBranches(groupId);
        List<WbGitSyncConfig> currentConfigs = syncConfigMapper.selectList(groupQuery(groupId));
        Map<String, WbGitSyncConfig> existingByBranch = currentConfigs.stream()
                .collect(java.util.stream.Collectors.toMap(
                        WbGitSyncConfig::getBranch,
                        Function.identity(),
                        (left, right) -> left,
                        java.util.LinkedHashMap::new
                ));

        int created = 0;
        int existing = 0;
        List<WbGitSyncConfig> accumulatedConfigs = new java.util.ArrayList<>(currentConfigs);
        for (String branch : branches) {
            WbGitSyncConfig config = existingByBranch.get(branch);
            if (config != null) {
                existing++;
                config.setGitConfigId(gitConfig.getId());
                upsertSyncFlow(config, gitConfig);
                syncConfigMapper.updateById(config);
                continue;
            }
            ensureNoIdentifierCollision(groupId, branch, accumulatedConfigs);
            config = new WbGitSyncConfig();
            config.setGroupId(groupId);
            config.setGitConfigId(gitConfig.getId());
            config.setBranch(branch);
            config.setEnabled(true);
            upsertSyncFlow(config, gitConfig);
            syncConfigMapper.insert(config);
            accumulatedConfigs.add(config);
            created++;
        }

        List<WbGitSyncConfig> configs = syncConfigMapper.selectList(groupQuery(groupId));
        return new AddAllGitSyncConfigsResponse(
                created,
                existing,
                configs.stream().map(this::toResponse).toList()
        );
    }

    public GitSyncConfigResponse setEnabled(Long groupId, Long id, boolean enabled) {
        WbGitSyncConfig config = requireConfig(groupId, id);
        config.setEnabled(enabled);
        upsertSyncFlow(config, gitConfigService.requireDecryptedConfig(groupId));
        syncConfigMapper.updateById(config);
        return toResponse(config);
    }

    public void delete(Long groupId, Long id) {
        WbGitSyncConfig config = requireConfig(groupId, id);
        kestraClient.deleteFlow(SYSTEM_NAMESPACE, GitSyncFlowSourceBuilder.buildSyncFlowId(groupId, config.getBranch()));
        syncConfigMapper.deleteById(id);
    }

    public TriggerGitSyncResponse trigger(Long groupId, Long id) {
        return triggerInternal(groupId, id, null);
    }

    private TriggerGitSyncResponse triggerInternal(Long groupId, Long id, Long publishRecordId) {
        WbGitSyncConfig config = requireConfig(groupId, id);
        if (!Boolean.TRUE.equals(config.getEnabled())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "同步配置已停用");
        }
        String syncFlowId = GitSyncFlowSourceBuilder.buildSyncFlowId(groupId, config.getBranch());
        KestraExecutionSnapshot execution;
        try {
            execution = kestraClient.createExecution(SYSTEM_NAMESPACE, syncFlowId);
        } catch (ResponseStatusException ex) {
            if (ex.getStatusCode().value() != HttpStatus.NOT_FOUND.value()) {
                throw ex;
            }
            log.warn("Kestra 同步流不存在，自动重建后重试触发: groupId={}, branch={}, syncFlowId={}",
                    groupId, config.getBranch(), syncFlowId);
            WbGitConfig gitConfig = gitConfigService.requireDecryptedConfig(groupId);
            config.setGitConfigId(gitConfig.getId());
            upsertSyncFlow(config, gitConfig);
            execution = kestraClient.createExecution(SYSTEM_NAMESPACE, syncFlowId);
        }
        LocalDateTime now = LocalDateTime.now();
        config.setLastSyncAt(now);
        config.setLastSyncStatus(execution.status());
        config.setLastSyncMessage(execution.id());
        syncConfigMapper.updateById(config);
        publishRecordService.markSyncExecution(publishRecordId, execution.id(), execution.status());
        return new TriggerGitSyncResponse(config.getId(), execution.id(), execution.status(), now);
    }

    public void triggerBranchAfterPush(Long publishRecordId, Long groupId, String branch) {
        WbGitSyncConfig config = syncConfigMapper.selectOne(groupBranchQuery(groupId, normalizeBranch(branch)));
        if (config == null || !Boolean.TRUE.equals(config.getEnabled())) {
            return;
        }
        try {
            triggerInternal(groupId, config.getId(), publishRecordId);
        } catch (RuntimeException ex) {
            config.setLastSyncAt(LocalDateTime.now());
            config.setLastSyncStatus("FAILED_TO_TRIGGER");
            config.setLastSyncMessage(ex.getMessage());
            syncConfigMapper.updateById(config);
            publishRecordService.markSyncTriggerFailed(publishRecordId, ex.getMessage());
        }
    }

    @EventListener
    public void handleRepoPushed(GitRepoPushedEvent event) {
        triggerBranchAfterPush(event.publishRecordId(), event.groupId(), event.branch());
    }

    private void upsertSyncFlow(WbGitSyncConfig config, WbGitConfig gitConfig) {
        kestraClient.upsertFlow(GitSyncFlowSourceBuilder.buildSyncFlowSource(
                gitConfig,
                config,
                syncProperties.getSyncCron()
        ));
    }

    private WbGitSyncConfig requireConfig(Long groupId, Long id) {
        WbGitSyncConfig config = syncConfigMapper.selectById(id);
        if (config == null || !groupId.equals(config.getGroupId())) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "同步配置不存在");
        }
        return config;
    }

    private Set<String> knownBranches(Long groupId) {
        return gitCommandService.listRemoteBranchNames(groupId).stream()
                .filter(name -> name != null && !name.isBlank())
                .collect(java.util.stream.Collectors.toCollection(LinkedHashSet::new));
    }

    private void ensureKnownBranch(Long groupId, String branch) {
        if (!knownBranches(groupId).contains(branch)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "分支不存在: " + branch);
        }
    }

    private void ensureNoIdentifierCollision(Long groupId, String branch, List<WbGitSyncConfig> existingConfigs) {
        if (existingConfigs == null || existingConfigs.isEmpty()) {
            return;
        }
        String targetNamespace = GitSyncFlowSourceBuilder.buildKestraNamespace(groupId, branch);
        String targetSyncFlowId = GitSyncFlowSourceBuilder.buildSyncFlowId(groupId, branch);
        for (WbGitSyncConfig other : existingConfigs) {
            if (branch.equals(other.getBranch())) {
                continue;
            }
            String otherNamespace = GitSyncFlowSourceBuilder.buildKestraNamespace(groupId, other.getBranch());
            String otherSyncFlowId = GitSyncFlowSourceBuilder.buildSyncFlowId(groupId, other.getBranch());
            if (targetNamespace.equals(otherNamespace) || targetSyncFlowId.equals(otherSyncFlowId)) {
                throw new ResponseStatusException(
                        HttpStatus.CONFLICT,
                        "分支 " + branch + " 与已有同步分支 " + other.getBranch() + " 映射到相同的 Kestra 命名空间或同步任务 ID"
                );
            }
        }
    }

    private GitSyncConfigResponse toResponse(WbGitSyncConfig config) {
        return new GitSyncConfigResponse(
                config.getId(),
                config.getGroupId(),
                config.getBranch(),
                GitSyncFlowSourceBuilder.buildKestraNamespace(config.getGroupId(), config.getBranch()),
                GitSyncFlowSourceBuilder.buildSyncFlowId(config.getGroupId(), config.getBranch()),
                Boolean.TRUE.equals(config.getEnabled()),
                config.getLastSyncAt(),
                config.getLastSyncStatus(),
                config.getLastSyncMessage(),
                config.getLastDeployedSha(),
                config.getLastDeployedAt(),
                config.getDeploymentEvidence()
        );
    }

    private LambdaQueryWrapper<WbGitSyncConfig> groupQuery(Long groupId) {
        return new LambdaQueryWrapper<WbGitSyncConfig>()
                .eq(WbGitSyncConfig::getGroupId, groupId)
                .orderByAsc(WbGitSyncConfig::getBranch);
    }

    private LambdaQueryWrapper<WbGitSyncConfig> groupBranchQuery(Long groupId, String branch) {
        return new LambdaQueryWrapper<WbGitSyncConfig>()
                .eq(WbGitSyncConfig::getGroupId, groupId)
                .eq(WbGitSyncConfig::getBranch, branch);
    }

    private String normalizeBranch(String branch) {
        if (branch == null || branch.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "分支不能为空");
        }
        return branch.trim();
    }

}
