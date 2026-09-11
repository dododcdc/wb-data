CREATE TABLE IF NOT EXISTS `wb_execution_parameter_snapshot` (
    `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
    `group_id` BIGINT NOT NULL COMMENT '所属项目组 ID',
    `snapshot_id` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '参数快照内容 SHA-256',
    `snapshot_json` LONGTEXT NOT NULL COMMENT '不可变参数快照 JSON',
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY `uk_execution_parameter_snapshot_group_hash` (`group_id`, `snapshot_id`),
    CONSTRAINT `fk_execution_parameter_snapshot_group` FOREIGN KEY (`group_id`) REFERENCES `wb_project_group` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='执行参数不可变快照注册表';
