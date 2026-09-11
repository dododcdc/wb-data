CREATE TABLE IF NOT EXISTS `wb_parameter_group` (
    `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
    `group_id` BIGINT NOT NULL COMMENT '所属项目组 ID',
    `code` VARCHAR(64) NOT NULL COMMENT '项目组内稳定且唯一的代码',
    `name` VARCHAR(100) NOT NULL COMMENT '参数组名称',
    `description` VARCHAR(500) NULL COMMENT '参数组描述',
    `version` INT NOT NULL DEFAULT 1 COMMENT '参数定义版本',
    `status` VARCHAR(16) NOT NULL DEFAULT 'ACTIVE' COMMENT 'ACTIVE / ARCHIVED',
    `created_by` BIGINT NOT NULL COMMENT '创建人 ID',
    `updated_by` BIGINT NOT NULL COMMENT '最后更新人 ID',
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY `uk_wb_parameter_group_group_code` (`group_id`, `code`),
    KEY `idx_wb_parameter_group_group_status` (`group_id`, `status`),
    CONSTRAINT `fk_wb_parameter_group_group` FOREIGN KEY (`group_id`) REFERENCES `wb_project_group` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_wb_parameter_group_created_by` FOREIGN KEY (`created_by`) REFERENCES `wb_user` (`id`),
    CONSTRAINT `fk_wb_parameter_group_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `wb_user` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='项目组参数组';

CREATE TABLE IF NOT EXISTS `wb_parameter_definition` (
    `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
    `parameter_group_id` BIGINT NOT NULL COMMENT '参数组 ID',
    `parameter_key` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '参数键，区分大小写',
    `data_type` VARCHAR(16) NOT NULL COMMENT 'STRING / INTEGER / BOOLEAN / DATE / DATETIME',
    `value_source` VARCHAR(16) NOT NULL COMMENT 'CONSTANT / SYSTEM_TIME',
    `constant_value` TEXT NULL COMMENT '规范化后的常量值',
    `timezone` VARCHAR(64) NULL COMMENT 'IANA 时区',
    `value_format` VARCHAR(64) NULL COMMENT '时间字符串格式',
    `offset_amount` INT NOT NULL DEFAULT 0 COMMENT '时间偏移量',
    `offset_unit` VARCHAR(16) NULL COMMENT 'V1 固定为 DAYS',
    `description` VARCHAR(255) NULL COMMENT '参数说明',
    `sort_order` INT NOT NULL DEFAULT 0 COMMENT '显示顺序',
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY `uk_wb_parameter_definition_group_key` (`parameter_group_id`, `parameter_key`),
    KEY `idx_wb_parameter_definition_group_order` (`parameter_group_id`, `sort_order`),
    CONSTRAINT `fk_wb_parameter_definition_group` FOREIGN KEY (`parameter_group_id`) REFERENCES `wb_parameter_group` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='参数组中的参数定义';
