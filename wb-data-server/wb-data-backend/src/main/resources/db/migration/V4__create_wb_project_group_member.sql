CREATE TABLE IF NOT EXISTS `wb_project_group_member` (
    `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
    `group_id` BIGINT NOT NULL COMMENT '项目组ID',
    `user_id` BIGINT NOT NULL COMMENT '用户ID',
    `role` VARCHAR(32) NOT NULL COMMENT 'GROUP_ADMIN | DEVELOPER',
    `created_by` BIGINT NOT NULL COMMENT '创建人',
    `updated_by` BIGINT NULL COMMENT '更新人',
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY `uk_wb_group_user` (`group_id`, `user_id`),
    KEY `idx_wb_group_member_user` (`user_id`),
    KEY `idx_wb_group_member_group_role` (`group_id`, `role`),
    CONSTRAINT `fk_wb_group_member_group` FOREIGN KEY (`group_id`) REFERENCES `wb_project_group` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_wb_group_member_user` FOREIGN KEY (`user_id`) REFERENCES `wb_user` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_wb_group_member_created_by` FOREIGN KEY (`created_by`) REFERENCES `wb_user` (`id`),
    CONSTRAINT `fk_wb_group_member_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `wb_user` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='项目组成员';
