CREATE TABLE IF NOT EXISTS `wb_offline_recent_flow` (
    `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
    `user_id` BIGINT NOT NULL COMMENT '用户ID',
    `group_id` BIGINT NOT NULL COMMENT '项目组ID',
    `flow_path` VARCHAR(512) NOT NULL COMMENT '任务相对路径',
    `accessed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '最近操作时间',
    UNIQUE KEY `uk_wb_offline_recent_flow` (`user_id`, `group_id`, `flow_path`),
    KEY `idx_wb_offline_recent_flow_user_group` (`user_id`, `group_id`, `accessed_at`),
    KEY `idx_wb_offline_recent_flow_group_path` (`group_id`, `flow_path`),
    CONSTRAINT `fk_wb_orf_user` FOREIGN KEY (`user_id`) REFERENCES `wb_user` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_wb_orf_group` FOREIGN KEY (`group_id`) REFERENCES `wb_project_group` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户在项目组下最近操作的离线任务';
