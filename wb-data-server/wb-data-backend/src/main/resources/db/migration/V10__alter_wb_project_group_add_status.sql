ALTER TABLE `wb_project_group` ADD COLUMN `status` VARCHAR(20) NOT NULL DEFAULT 'active' COMMENT '项目组状态：active=正常，disabled=已禁用' AFTER `description`;

CREATE INDEX `idx_wb_project_group_status` ON `wb_project_group`(`status`);
