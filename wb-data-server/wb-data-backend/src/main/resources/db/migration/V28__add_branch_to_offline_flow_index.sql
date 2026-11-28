ALTER TABLE `wb_offline_flow_index`
    ADD COLUMN `branch` VARCHAR(191) NOT NULL DEFAULT 'main' COMMENT '所属 Git 分支' AFTER `group_id`;

UPDATE `wb_offline_flow_index` fi
    JOIN `wb_offline_repo_index_state` rs ON fi.`group_id` = rs.`group_id`
SET fi.`branch` = LEFT(TRIM(rs.`synced_branch`), 191)
WHERE rs.`synced_branch` IS NOT NULL AND TRIM(rs.`synced_branch`) <> '';

ALTER TABLE `wb_offline_flow_index`
    ADD UNIQUE KEY `uk_ofi_group_branch_path` (`group_id`, `branch`, `flow_path`),
    ADD KEY `idx_ofi_group_branch_flow_id` (`group_id`, `branch`, `flow_id`),
    ADD KEY `idx_ofi_group_branch_owner` (`group_id`, `branch`, `owner_user_id`),
    DROP INDEX `uk_ofi_group_path`,
    DROP INDEX `idx_ofi_group_flow_id`;

ALTER TABLE `wb_offline_repo_index_state`
    ADD COLUMN `branch` VARCHAR(191) NOT NULL DEFAULT 'main' COMMENT '所属 Git 分支' AFTER `group_id`,
    ADD KEY `idx_oris_group` (`group_id`);

UPDATE `wb_offline_repo_index_state`
SET `branch` = LEFT(TRIM(`synced_branch`), 191)
WHERE `synced_branch` IS NOT NULL AND TRIM(`synced_branch`) <> '';

ALTER TABLE `wb_offline_repo_index_state`
    DROP PRIMARY KEY,
    ADD PRIMARY KEY (`group_id`, `branch`);
