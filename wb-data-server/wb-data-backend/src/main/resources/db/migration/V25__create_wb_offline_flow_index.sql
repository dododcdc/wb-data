CREATE TABLE IF NOT EXISTS `wb_offline_flow_index` (
    `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
    `group_id` BIGINT NOT NULL COMMENT '项目组 ID',
    `flow_path` VARCHAR(512) NOT NULL COMMENT '任务相对路径（如 _flows/foo/flow.yaml）',
    `flow_id` VARCHAR(191) NULL COMMENT 'Flow YAML 中的任务标识',
    `parse_status` VARCHAR(16) NOT NULL DEFAULT 'OK' COMMENT 'OK | INVALID',
    `has_schedule` BOOLEAN NOT NULL DEFAULT FALSE COMMENT '是否配置调度 trigger',
    `schedule_enabled` BOOLEAN NOT NULL DEFAULT FALSE COMMENT '调度是否启用',
    `schedule_period` VARCHAR(32) NULL COMMENT '调度周期（HOURLY/DAILY/.../CUSTOM）',
    `schedule_cron` VARCHAR(128) NULL COMMENT 'Cron 表达式',
    `schedule_timezone` VARCHAR(64) NULL COMMENT '调度时区',
    `cross_group_dependency` VARCHAR(16) NOT NULL DEFAULT 'ALLOW' COMMENT 'ALLOW | DENY',
    `failure_policy` VARCHAR(16) NOT NULL DEFAULT 'CONTINUE' COMMENT 'CONTINUE | PAUSE',
    `dependency_count` INT NOT NULL DEFAULT 0 COMMENT '前置依赖数量',
    `file_mtime_ms` BIGINT NOT NULL DEFAULT 0 COMMENT 'flow.yaml 最近修改毫秒时间戳',
    `file_size` BIGINT NOT NULL DEFAULT 0 COMMENT 'flow.yaml 文件字节大小',
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    UNIQUE KEY `uk_ofi_group_path` (`group_id`, `flow_path`),
    KEY `idx_ofi_group_flow_id` (`group_id`, `flow_id`),
    KEY `idx_ofi_parse_status` (`parse_status`),
    CONSTRAINT `fk_ofi_group` FOREIGN KEY (`group_id`) REFERENCES `wb_project_group` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='离线任务元数据投影索引';

CREATE TABLE IF NOT EXISTS `wb_offline_flow_dependency` (
    `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
    `flow_index_id` BIGINT NOT NULL COMMENT '下游任务索引 ID',
    `downstream_group_id` BIGINT NOT NULL COMMENT '下游项目组 ID',
    `downstream_flow_id` VARCHAR(191) NOT NULL COMMENT '下游任务标识',
    `upstream_group_id` BIGINT NOT NULL COMMENT '上游项目组 ID',
    `upstream_flow_id` VARCHAR(191) NOT NULL COMMENT '上游任务标识',
    UNIQUE KEY `uk_ofd_edge` (`flow_index_id`, `upstream_group_id`, `upstream_flow_id`),
    KEY `idx_ofd_upstream` (`upstream_group_id`, `upstream_flow_id`),
    KEY `idx_ofd_downstream_flow` (`downstream_group_id`, `downstream_flow_id`),
    CONSTRAINT `fk_ofd_flow_index` FOREIGN KEY (`flow_index_id`) REFERENCES `wb_offline_flow_index` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='离线任务有向依赖边索引';

CREATE TABLE IF NOT EXISTS `wb_offline_repo_index_state` (
    `group_id` BIGINT PRIMARY KEY COMMENT '项目组 ID',
    `synced_branch` VARCHAR(255) NULL COMMENT '最近对账分支',
    `synced_head_sha` VARCHAR(64) NULL COMMENT '最近对账 HEAD 提交 SHA',
    `flow_count` INT NOT NULL DEFAULT 0 COMMENT '任务数量',
    `indexed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    CONSTRAINT `fk_oris_group` FOREIGN KEY (`group_id`) REFERENCES `wb_project_group` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='离线仓库索引对账状态';
