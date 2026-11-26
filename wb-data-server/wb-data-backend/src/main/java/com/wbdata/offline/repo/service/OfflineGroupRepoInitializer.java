package com.wbdata.offline.repo.service;

import com.wbdata.group.service.GroupCreatedEvent;
import com.wbdata.offline.config.OfflineProperties;
import com.wbdata.offline.service.OfflineFlowIndexService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.event.EventListener;
import org.springframework.lang.Nullable;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

/**
 * 监听项目组创建事件并在仓库锁保护下初始化离线开发本地 Git 工作树。
 */
@Component
public class OfflineGroupRepoInitializer extends GitRepositoryOperations {

    private final RepoLockManager repoLockManager;
    @Nullable
    private OfflineFlowIndexService offlineFlowIndexService;

    public OfflineGroupRepoInitializer(OfflineProperties offlineProperties, RepoLockManager repoLockManager) {
        super(offlineProperties);
        this.repoLockManager = repoLockManager;
    }

    @Autowired(required = false)
    public void setOfflineFlowIndexService(@Nullable OfflineFlowIndexService offlineFlowIndexService) {
        this.offlineFlowIndexService = offlineFlowIndexService;
    }

    @EventListener
    public void onGroupCreated(GroupCreatedEvent event) {
        repoLockManager.withLock(event.groupId(), () -> {
            initLocalRepo(event.groupId());
            if (offlineFlowIndexService != null) {
                offlineFlowIndexService.onGroupRepoInitialized(event.groupId(), "main");
            }
            return null;
        });
    }

    private void initLocalRepo(Long groupId) {
        Path repoPath = repoPath(groupId);
        try {
            Files.createDirectories(repoPath);
            Files.createDirectories(repoPath.resolve("_flows"));
            Files.createDirectories(repoPath.resolve("scripts"));
            Files.writeString(repoPath.resolve("_flows/.gitkeep"), "", StandardCharsets.UTF_8);
            Files.writeString(repoPath.resolve("scripts/.gitkeep"), "", StandardCharsets.UTF_8);
            OfflineKestraIgnoreSupport.ensureKestraIgnoreIfMissing(repoPath);
            runGit(repoPath, "init", "--initial-branch=main");
        } catch (IOException | GitException | ResponseStatusException ex) {
            throw new IllegalStateException("初始化本地仓库失败: " + repoPath, ex);
        }
    }
}
