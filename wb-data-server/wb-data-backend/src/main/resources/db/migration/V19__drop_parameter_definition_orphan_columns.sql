-- V16 将参数时间模型迁移到 time_basis/offset_days 后，以下旧列不再被实体读取，删除孤儿列。
ALTER TABLE `wb_parameter_definition`
    DROP COLUMN `data_type`,
    DROP COLUMN `timezone`,
    DROP COLUMN `offset_amount`,
    DROP COLUMN `offset_unit`;
