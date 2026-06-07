CREATE TABLE IF NOT EXISTS `wb_operation_execution_action` (
    `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
    `group_id` BIGINT NOT NULL COMMENT '项目组 ID',
    `action_type` VARCHAR(32) NOT NULL COMMENT '操作类型',
    `original_execution_id` VARCHAR(128) NOT NULL COMMENT '原始执行 ID',
    `new_execution_id` VARCHAR(128) NOT NULL COMMENT '新执行 ID',
    `namespace` VARCHAR(180) NOT NULL COMMENT 'Kestra 命名空间',
    `flow_id` VARCHAR(180) NOT NULL COMMENT 'Kestra Flow ID',
    `requested_by` BIGINT NOT NULL COMMENT '请求用户 ID',
    `requested_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '请求时间',
    KEY `idx_operation_action_group_requested_at` (`group_id`, `requested_at`),
    KEY `idx_operation_action_original_execution` (`original_execution_id`),
    KEY `idx_operation_action_new_execution` (`new_execution_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='运维执行操作审计';
