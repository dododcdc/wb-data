package com.wbdata.git.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.wbdata.git.entity.WbGitSyncConfig;
import com.wbdata.git.mapper.WbGitSyncConfigMapper;
import com.wbdata.offline.repo.service.GitCommandService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Service;

import java.util.List;

@Slf4j
@Service
@RequiredArgsConstructor
public class OfflinePublishBaselineService {

    private final WbGitSyncConfigMapper syncConfigMapper;
    private final GitCommandService gitCommandService;
    private final OfflinePublishRecordService publishRecordService;

    @EventListener(ApplicationReadyEvent.class)
    public void backfillBaselines() {
        List<WbGitSyncConfig> configs = syncConfigMapper.selectList(new LambdaQueryWrapper<WbGitSyncConfig>()
                .eq(WbGitSyncConfig::getEnabled, true));
        for (WbGitSyncConfig config : configs) {
            try {
                String afterSha = gitCommandService.readRemoteBranchSha(config.getGroupId(), config.getBranch());
                if (afterSha != null && !afterSha.isBlank()) {
                    publishRecordService.recordBaseline(config.getGroupId(), config.getBranch(), afterSha);
                }
            } catch (RuntimeException ex) {
                log.warn("推送基线回填失败: groupId={}, branch={}, message={}",
                        config.getGroupId(), config.getBranch(), ex.getMessage());
            }
        }
    }
}
