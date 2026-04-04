CREATE TABLE IF NOT EXISTS `wb_user` (
    `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
    `username` VARCHAR(64) NOT NULL COMMENT '登录名，唯一',
    `password_hash` VARCHAR(255) NOT NULL COMMENT '登录密码哈希',
    `display_name` VARCHAR(64) NOT NULL COMMENT '展示名',
    `system_role` VARCHAR(32) NOT NULL DEFAULT 'USER' COMMENT 'SYSTEM_ADMIN | USER',
    `status` VARCHAR(32) NOT NULL DEFAULT 'ACTIVE' COMMENT 'ACTIVE | DISABLED',
    `last_login_at` DATETIME NULL COMMENT '最近登录时间',
    `created_by` BIGINT NULL COMMENT '创建人',
    `updated_by` BIGINT NULL COMMENT '更新人',
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY `uk_wb_user_username` (`username`),
    KEY `idx_wb_user_status` (`status`),
    CONSTRAINT `fk_wb_user_created_by` FOREIGN KEY (`created_by`) REFERENCES `wb_user` (`id`) ON DELETE SET NULL,
    CONSTRAINT `fk_wb_user_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `wb_user` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='系统用户';
