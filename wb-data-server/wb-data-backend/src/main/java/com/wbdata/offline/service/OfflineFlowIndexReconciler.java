package com.wbdata.offline.service;

import lombok.RequiredArgsConstructor;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

/**
 * 应用启动后执行全项目组离线任务投影索引的增量对账（未变动文件按 mtime + size 跳过解析）。
 */
@Component
@Order(10)
@RequiredArgsConstructor
public class OfflineFlowIndexReconciler implements ApplicationRunner {

    private final OfflineFlowIndexService offlineFlowIndexService;

    @Override
    public void run(ApplicationArguments args) {
        offlineFlowIndexService.reconcileAllExistingGroupsAtStartup();
    }
}
