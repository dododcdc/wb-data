CREATE TABLE IF NOT EXISTS `wb_project_group` (
    `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
    `name` VARCHAR(100) NOT NULL COMMENT '项目组名称',
    `description` VARCHAR(255) NULL COMMENT '项目组描述',
    `created_by` BIGINT NOT NULL COMMENT '创建人',
    `updated_by` BIGINT NULL COMMENT '更新人',
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY `uk_wb_project_group_name` (`name`),
    CONSTRAINT `fk_wb_project_group_created_by` FOREIGN KEY (`created_by`) REFERENCES `wb_user` (`id`),
    CONSTRAINT `fk_wb_project_group_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `wb_user` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='项目组';
