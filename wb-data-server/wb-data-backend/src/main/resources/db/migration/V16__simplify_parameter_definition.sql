ALTER TABLE `wb_parameter_definition`
    ADD COLUMN `time_basis` VARCHAR(32) NULL COMMENT 'PLANNED_TIME / EXECUTION_START_TIME' AFTER `constant_value`,
    ADD COLUMN `offset_days` INT NOT NULL DEFAULT 0 COMMENT '按日历日偏移' AFTER `value_format`;

UPDATE `wb_parameter_definition`
SET `time_basis` = 'PLANNED_TIME'
WHERE `value_source` = 'SYSTEM_TIME';

UPDATE `wb_parameter_definition`
SET `offset_days` = `offset_amount`,
    `data_type` = 'STRING';

ALTER TABLE `wb_parameter_definition`
    ALTER COLUMN `data_type` SET DEFAULT 'STRING';
