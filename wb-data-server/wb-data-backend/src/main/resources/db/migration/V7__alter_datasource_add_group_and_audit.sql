ALTER TABLE `datasource`
    ADD COLUMN `group_id` BIGINT NULL COMMENT '所属项目组ID' AFTER `id`,
    ADD COLUMN `created_by` BIGINT NULL COMMENT '创建人ID' AFTER `owner`,
    ADD COLUMN `updated_by` BIGINT NULL COMMENT '更新人ID' AFTER `created_by`;

ALTER TABLE `datasource`
    ADD UNIQUE KEY `uk_datasource_group_name` (`group_id`, `name`),
    ADD KEY `idx_datasource_group_status_created` (`group_id`, `status`, `created_at`),
    ADD KEY `idx_datasource_group_type` (`group_id`, `type`);
