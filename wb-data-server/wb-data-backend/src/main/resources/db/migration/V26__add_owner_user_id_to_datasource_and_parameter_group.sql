ALTER TABLE `datasource`
    ADD COLUMN `owner_user_id` BIGINT NULL COMMENT '负责人用户 ID' AFTER `owner`;

UPDATE `datasource` d
INNER JOIN `wb_user` u ON TRIM(d.owner) = u.username
SET d.owner_user_id = u.id
WHERE d.owner_user_id IS NULL
  AND d.owner IS NOT NULL
  AND TRIM(d.owner) <> '';

UPDATE `datasource` d
INNER JOIN `wb_user` u ON d.created_by = u.id
SET d.owner_user_id = u.id
WHERE d.owner_user_id IS NULL
  AND d.created_by IS NOT NULL;

ALTER TABLE `datasource`
    ADD KEY `idx_datasource_group_owner` (`group_id`, `owner_user_id`),
    ADD CONSTRAINT `fk_datasource_owner_user` FOREIGN KEY (`owner_user_id`) REFERENCES `wb_user` (`id`);

ALTER TABLE `wb_parameter_group`
    ADD COLUMN `owner_user_id` BIGINT NULL COMMENT '负责人用户 ID' AFTER `status`;

UPDATE `wb_parameter_group`
SET `owner_user_id` = `created_by`
WHERE `owner_user_id` IS NULL;

ALTER TABLE `wb_parameter_group`
    MODIFY COLUMN `owner_user_id` BIGINT NOT NULL COMMENT '负责人用户 ID',
    ADD KEY `idx_wb_parameter_group_group_owner` (`group_id`, `owner_user_id`),
    ADD CONSTRAINT `fk_wb_parameter_group_owner_user` FOREIGN KEY (`owner_user_id`) REFERENCES `wb_user` (`id`);
