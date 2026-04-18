ALTER TABLE wb_git_config
  ADD COLUMN `project_group_id` BIGINT NOT NULL AFTER `id`,
  DROP INDEX `uk_wb_git_config_provider`,
  ADD UNIQUE KEY `uk_wb_git_config_group_id` (`project_group_id`);
