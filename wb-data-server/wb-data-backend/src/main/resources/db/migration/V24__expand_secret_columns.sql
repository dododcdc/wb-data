ALTER TABLE `datasource`
    MODIFY COLUMN `password` VARCHAR(512) NULL COMMENT '加密存储的密码';

ALTER TABLE `wb_git_config`
    MODIFY COLUMN `token` VARCHAR(1024) NOT NULL COMMENT '加密存储的 PAT';
