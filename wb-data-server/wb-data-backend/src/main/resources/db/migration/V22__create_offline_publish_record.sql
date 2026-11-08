CREATE TABLE IF NOT EXISTS `wb_offline_publish_record` (
    `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
    `group_id` BIGINT NOT NULL COMMENT '项目组 ID',
    `branch` VARCHAR(255) NOT NULL COMMENT 'Git 分支名',
    `record_type` VARCHAR(20) NOT NULL COMMENT 'PUSH | BASELINE | RECONCILED',
    `before_sha` VARCHAR(64) NULL COMMENT '推送前远端 HEAD',
    `after_sha` VARCHAR(64) NOT NULL COMMENT '推送后远端 HEAD',
    `pushed_by` BIGINT NULL COMMENT '推送用户 ID',
    `pushed_at` DATETIME NULL COMMENT '实际推送时间，基线和对账记录为空',
    `sync_enabled_at_push` BOOLEAN NOT NULL DEFAULT FALSE COMMENT '推送时是否启用 Kestra 同步',
    `sync_execution_id` VARCHAR(64) NULL COMMENT '关联的 Kestra 同步执行 ID',
    `sync_status` VARCHAR(32) NOT NULL COMMENT 'NONE | PENDING | RUNNING | SUCCESS | FAILED | UNKNOWN',
    `sync_message` VARCHAR(1000) NULL COMMENT '最近一次同步说明',
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY `idx_publish_record_group_branch_time` (`group_id`, `branch`, `pushed_at`, `id`),
    KEY `idx_publish_record_group_branch_after` (`group_id`, `branch`, `after_sha`),
    CONSTRAINT `fk_publish_record_group` FOREIGN KEY (`group_id`) REFERENCES `wb_project_group` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='离线任务推送与发布记录';

ALTER TABLE `wb_git_sync_config`
    ADD COLUMN `last_deployed_sha` VARCHAR(64) NULL COMMENT '最后确认的部署提交 SHA' AFTER `last_sync_message`,
    ADD COLUMN `last_deployed_at` DATETIME NULL COMMENT '最后确认部署时间' AFTER `last_deployed_sha`,
    ADD COLUMN `deployment_evidence` VARCHAR(32) NOT NULL DEFAULT 'UNCONFIRMED' COMMENT 'UNCONFIRMED | CONFIRMED | UNKNOWN' AFTER `last_deployed_at`,
    ADD COLUMN `last_evidence_at` DATETIME NULL COMMENT '最近一次部署证据对应的执行结束时间' AFTER `deployment_evidence`;
