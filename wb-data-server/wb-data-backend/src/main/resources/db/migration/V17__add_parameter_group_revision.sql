ALTER TABLE `wb_parameter_group`
    ADD COLUMN `revision` INT NOT NULL DEFAULT 1 COMMENT '并发修订号，每次实际修改递增' AFTER `version`;
