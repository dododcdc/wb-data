CREATE TABLE IF NOT EXISTS `wb_git_config` (
    `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
    `provider` VARCHAR(20) NOT NULL COMMENT 'github | gitlab | gitea',
    `username` VARCHAR(255) NOT NULL COMMENT '用户名',
    `token` VARCHAR(500) NOT NULL COMMENT '加密存储的 PAT',
    `base_url` VARCHAR(500) NOT NULL DEFAULT 'https://github.com' COMMENT '代码托管平台地址',
    `owner` VARCHAR(255) NOT NULL COMMENT 'org / group / username',
    `updated_by` BIGINT NULL COMMENT '最后修改人',
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY `uk_wb_git_config_provider` (`provider`),
    CONSTRAINT `fk_wb_git_config_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `wb_user` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Git 远程提供商配置';
