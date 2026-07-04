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
import com.wbdata.offline.service.GitCommandService;
import com.wbdata.offline.service.GitRepoPushedEvent;
import com.wbdata.offline.service.KestraClient;
import com.wbdata.offline.service.KestraExecutionSnapshot;
import lombok.RequiredArgsConstructor;
import org.springframework.context.event.EventListener;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.LocalDateTime;
import java.util.HexFormat;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;

@Service
@RequiredArgsConstructor
public class GitSyncConfigService {
    private static final int KESTRA_IDENTIFIER_MAX_LENGTH = 150;
    private static final String SYSTEM_NAMESPACE = "system";

    private final WbGitSyncConfigMapper syncConfigMapper;
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
        Map<String, WbGitSyncConfig> existingByBranch = syncConfigMapper.selectList(groupQuery(groupId)).stream()
                .collect(java.util.stream.Collectors.toMap(
                        WbGitSyncConfig::getBranch,
                        Function.identity(),
                        (left, right) -> left,
                        java.util.LinkedHashMap::new
                ));

        int created = 0;
        int existing = 0;
        for (String branch : branches) {
            WbGitSyncConfig config = existingByBranch.get(branch);
            if (config != null) {
                existing++;
                config.setGitConfigId(gitConfig.getId());
                upsertSyncFlow(config, gitConfig);
                syncConfigMapper.updateById(config);
                continue;
            }
            config = new WbGitSyncConfig();
            config.setGroupId(groupId);
            config.setGitConfigId(gitConfig.getId());
            config.setBranch(branch);
            config.setEnabled(true);
            upsertSyncFlow(config, gitConfig);
            syncConfigMapper.insert(config);
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
        syncConfigMapper.updateById(config);
        upsertSyncFlow(config, gitConfigService.requireDecryptedConfig(groupId));
        return toResponse(config);
    }

    public void delete(Long groupId, Long id) {
        WbGitSyncConfig config = requireConfig(groupId, id);
        kestraClient.deleteFlow(SYSTEM_NAMESPACE, buildSyncFlowId(groupId, config.getBranch()));
        syncConfigMapper.deleteById(id);
    }

    public TriggerGitSyncResponse trigger(Long groupId, Long id) {
        WbGitSyncConfig config = requireConfig(groupId, id);
        if (!Boolean.TRUE.equals(config.getEnabled())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "同步配置已停用");
        }
        KestraExecutionSnapshot execution = kestraClient.createExecution(SYSTEM_NAMESPACE, buildSyncFlowId(groupId, config.getBranch()));
        LocalDateTime now = LocalDateTime.now();
        config.setLastSyncAt(now);
        config.setLastSyncStatus(execution.status());
        config.setLastSyncMessage(execution.id());
        syncConfigMapper.updateById(config);
        return new TriggerGitSyncResponse(config.getId(), execution.id(), execution.status(), now);
    }

    public void triggerBranchAfterPush(Long groupId, String branch) {
        WbGitSyncConfig config = syncConfigMapper.selectOne(groupBranchQuery(groupId, normalizeBranch(branch)));
        if (config == null || !Boolean.TRUE.equals(config.getEnabled())) {
            return;
        }
        try {
            trigger(groupId, config.getId());
        } catch (RuntimeException ex) {
            config.setLastSyncAt(LocalDateTime.now());
            config.setLastSyncStatus("FAILED_TO_TRIGGER");
            config.setLastSyncMessage(ex.getMessage());
            syncConfigMapper.updateById(config);
        }
    }

    @EventListener
    public void handleRepoPushed(GitRepoPushedEvent event) {
        triggerBranchAfterPush(event.groupId(), event.branch());
    }

    String buildKestraNamespace(Long groupId, String branch) {
        return boundedIdentifier("g" + groupId + "-", branch);
    }

    String buildSyncFlowId(Long groupId, String branch) {
        return boundedIdentifier("sync-flows-g" + groupId + "-", branch);
    }

    String buildSyncFlowSource(WbGitConfig gitConfig, WbGitSyncConfig config) {
        Long groupId = config.getGroupId();
        String branch = config.getBranch();
        String namespace = buildKestraNamespace(groupId, branch);
        String syncFlowId = buildSyncFlowId(groupId, branch);
        String repositoryUrl = buildRepositoryUrl(gitConfig, groupId);
        boolean disabled = !Boolean.TRUE.equals(config.getEnabled());

        return """
                id: %s
                namespace: system
                description: "Auto-sync wb-data group %s branch %s"
                inputs:
                  - id: git_username
                    type: STRING
                    defaults: "%s"
                  - id: git_token
                    type: STRING
                    defaults: "%s"
                triggers:
                  - id: schedule
                    type: io.kestra.plugin.core.trigger.Schedule
                    cron: "%s"
                    disabled: %s
                tasks:
                  - id: sync_flows
                    type: io.kestra.plugin.git.SyncFlows
                    url: "%s"
                    branch: %s
                    username: "{{ inputs.git_username }}"
                    password: "{{ inputs.git_token }}"
                    targetNamespace: %s
                    gitDirectory: .wb-data/kestra-flows
                    delete: true
                  - id: sync_files
                    type: io.kestra.plugin.git.SyncNamespaceFiles
                    url: "%s"
                    branch: %s
                    username: "{{ inputs.git_username }}"
                    password: "{{ inputs.git_token }}"
                    namespace: %s
                    gitDirectory: .
                    delete: true
                """.formatted(
                syncFlowId,
                groupId,
                yamlDoubleQuoted(branch),
                yamlDoubleQuoted(gitConfig.getUsername()),
                yamlDoubleQuoted(gitConfig.getToken()),
                yamlDoubleQuoted(syncProperties.getSyncCron()),
                disabled,
                yamlDoubleQuoted(repositoryUrl),
                branch,
                namespace,
                yamlDoubleQuoted(repositoryUrl),
                branch,
                namespace
        );
    }

    private void upsertSyncFlow(WbGitSyncConfig config, WbGitConfig gitConfig) {
        kestraClient.upsertFlow(buildSyncFlowSource(gitConfig, config));
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

    private GitSyncConfigResponse toResponse(WbGitSyncConfig config) {
        return new GitSyncConfigResponse(
                config.getId(),
                config.getGroupId(),
                config.getBranch(),
                buildKestraNamespace(config.getGroupId(), config.getBranch()),
                buildSyncFlowId(config.getGroupId(), config.getBranch()),
                Boolean.TRUE.equals(config.getEnabled()),
                config.getLastSyncAt(),
                config.getLastSyncStatus(),
                config.getLastSyncMessage()
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

    private String boundedIdentifier(String prefix, String branch) {
        String slug = slugBranch(branch);
        if ((prefix + slug).length() <= KESTRA_IDENTIFIER_MAX_LENGTH) {
            return prefix + slug;
        }
        String hash = sha256Hex(branch).substring(0, 8);
        int slugMaxLength = KESTRA_IDENTIFIER_MAX_LENGTH - prefix.length() - hash.length() - 1;
        if (slugMaxLength <= 0) {
            throw new IllegalStateException("Kestra 标识前缀过长");
        }
        String truncated = slug.substring(0, Math.min(slug.length(), slugMaxLength)).replaceAll("-+$", "");
        if (truncated.isBlank()) {
            truncated = "branch";
        }
        return prefix + truncated + "-" + hash;
    }

    private String slugBranch(String branch) {
        String slug = (branch == null || branch.isBlank() ? "branch" : branch)
                .toLowerCase(Locale.ROOT)
                .replaceAll("[^a-z0-9]+", "-")
                .replaceAll("-+", "-")
                .replaceAll("^-|-$", "");
        return slug.isBlank() ? "branch" : slug;
    }

    private String sha256Hex(String value) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(digest.digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException("计算分支哈希失败", ex);
        }
    }

    private String buildRepositoryUrl(WbGitConfig config, Long groupId) {
        return config.getBaseUrl().replaceFirst("/$", "") + "/"
                + config.getUsername() + "/wb-data-" + groupId + ".git";
    }

    private String yamlDoubleQuoted(String value) {
        return value == null ? "" : value.replace("\\", "\\\\").replace("\"", "\\\"");
    }
}
