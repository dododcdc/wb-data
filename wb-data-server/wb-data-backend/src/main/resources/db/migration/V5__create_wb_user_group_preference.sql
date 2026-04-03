CREATE TABLE IF NOT EXISTS `wb_user_group_preference` (
    `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
    `user_id` BIGINT NOT NULL COMMENT '用户ID',
    `group_id` BIGINT NOT NULL COMMENT '项目组ID',
    `default_datasource_id` BIGINT NULL COMMENT '默认数据源ID',
    `last_accessed_at` DATETIME NULL COMMENT '最近访问该项目组时间',
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY `uk_wb_user_group_preference` (`user_id`, `group_id`),
    CONSTRAINT `fk_wb_ugp_user` FOREIGN KEY (`user_id`) REFERENCES `wb_user` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_wb_ugp_group` FOREIGN KEY (`group_id`) REFERENCES `wb_project_group` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户在项目组下的个人偏好';
