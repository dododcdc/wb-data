package com.wbdata.group.service;

/**
 * 新项目组创建后发布的领域事件，用于通知离线域初始化本地 Git 仓库。
 */
public record GroupCreatedEvent(Long groupId) {
}
