INSERT INTO datasource (
    group_id, name, type, description, host, port, database_name,
    username, password, status, owner, created_by, updated_by
)
SELECT
    project_group.id,
    'it_transfer_mysql',
    'MYSQL',
    'Local JDBC transfer source and target tables',
    'localhost',
    13306,
    'transfer_demo',
    'wbdata',
    'wbdata123',
    'ENABLED',
    'admin',
    admin_user.id,
    admin_user.id
FROM wb_project_group AS project_group
JOIN wb_user AS admin_user ON admin_user.username = 'admin'
WHERE project_group.name = 'policy'
ON DUPLICATE KEY UPDATE
    type = VALUES(type),
    description = VALUES(description),
    host = VALUES(host),
    port = VALUES(port),
    database_name = VALUES(database_name),
    username = VALUES(username),
    password = VALUES(password),
    status = VALUES(status),
    updated_by = VALUES(updated_by);

INSERT INTO datasource (
    group_id, name, type, description, host, port, database_name,
    username, password, status, owner, created_by, updated_by
)
SELECT
    project_group.id,
    'it_transfer_hive',
    'HIVE',
    'Local JDBC transfer Hive source and target tables',
    'localhost',
    10000,
    'default',
    'hive',
    '',
    'ENABLED',
    'admin',
    admin_user.id,
    admin_user.id
FROM wb_project_group AS project_group
JOIN wb_user AS admin_user ON admin_user.username = 'admin'
WHERE project_group.name = 'policy'
ON DUPLICATE KEY UPDATE
    type = VALUES(type),
    description = VALUES(description),
    host = VALUES(host),
    port = VALUES(port),
    database_name = VALUES(database_name),
    username = VALUES(username),
    password = VALUES(password),
    status = VALUES(status),
    updated_by = VALUES(updated_by);
