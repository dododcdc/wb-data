CREATE TABLE IF NOT EXISTS `datasource` (
    `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
    `name` VARCHAR(100) NOT NULL COMMENT '数据源名称',
    `type` VARCHAR(50) NOT NULL COMMENT '类型: MYSQL, HIVE, STARROCKS等',
    `description` VARCHAR(255) COMMENT '描述',
    `host` VARCHAR(255) COMMENT '主机名/IP',
    `port` INT COMMENT '端口',
    `database_name` VARCHAR(100) COMMENT '数据库名',
    `username` VARCHAR(100) COMMENT '用户名',
    `password` VARCHAR(255) COMMENT '密码',
    `connection_params` JSON COMMENT '额外连接参数(JSON)',
    `status` VARCHAR(20) DEFAULT 'ENABLED' COMMENT '状态: ENABLED(启用), DISABLED(禁用)',
    `owner` VARCHAR(50) COMMENT '创建者',
    `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='数据源管理表';
