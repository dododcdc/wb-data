ALTER TABLE `wb_offline_flow_index`
    ADD COLUMN `owner_user_id` BIGINT NULL COMMENT '任务负责人用户 ID（投影自 flow.yaml labels.wbdataOwnerUserId）' AFTER `flow_id`,
    ADD KEY `idx_ofi_group_owner` (`group_id`, `owner_user_id`);
