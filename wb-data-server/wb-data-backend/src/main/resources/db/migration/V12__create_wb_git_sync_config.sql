CREATE TABLE IF NOT EXISTS `wb_git_sync_config` (
    `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
    `group_id` BIGINT NOT NULL COMMENT '项目组 ID',
    `git_config_id` BIGINT NOT NULL COMMENT '关联 Git 配置 ID',
    `branch` VARCHAR(255) NOT NULL COMMENT 'Git 分支名',
    `enabled` BOOLEAN NOT NULL DEFAULT TRUE COMMENT '是否启用 Kestra 同步',
    `last_sync_at` DATETIME NULL COMMENT '最近一次触发同步时间',
    `last_sync_status` VARCHAR(32) NULL COMMENT '最近一次同步状态',
    `last_sync_message` VARCHAR(1000) NULL COMMENT '最近一次同步说明',
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY `uk_wb_git_sync_config_group_branch` (`group_id`, `branch`),
    KEY `idx_wb_git_sync_config_git_config` (`git_config_id`),
    CONSTRAINT `fk_wb_git_sync_config_group` FOREIGN KEY (`group_id`) REFERENCES `wb_project_group` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_wb_git_sync_config_git_config` FOREIGN KEY (`git_config_id`) REFERENCES `wb_git_config` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Git 分支到 Kestra 同步配置';
