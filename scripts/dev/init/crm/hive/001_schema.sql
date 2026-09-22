-- CRM 场景测试：Hive ODS / DM 层表结构
-- 用法: docker exec -i wb-data-hiveserver2 beeline -u 'jdbc:hive2://localhost:10000/default' -f /dev/stdin < scripts/dev/init/crm/hive/001_schema.sql
CREATE DATABASE IF NOT EXISTS ods_crm;
CREATE DATABASE IF NOT EXISTS dm_crm;

DROP TABLE IF EXISTS ods_crm.ods_user_all_d;
CREATE TABLE ods_crm.ods_user_all_d (
    user_id BIGINT,
    name STRING,
    gender STRING,
    city STRING,
    level INT,
    created_at TIMESTAMP
) PARTITIONED BY (dt STRING) STORED AS PARQUET;

DROP TABLE IF EXISTS ods_crm.ods_store_all_d;
CREATE TABLE ods_crm.ods_store_all_d (
    store_id BIGINT,
    name STRING,
    city STRING,
    region STRING
) PARTITIONED BY (dt STRING) STORED AS PARQUET;

DROP TABLE IF EXISTS ods_crm.ods_product_all_d;
CREATE TABLE ods_crm.ods_product_all_d (
    product_id BIGINT,
    name STRING,
    category STRING,
    price DECIMAL(10, 2)
) PARTITIONED BY (dt STRING) STORED AS PARQUET;

DROP TABLE IF EXISTS ods_crm.ods_orders_all_d;
CREATE TABLE ods_crm.ods_orders_all_d (
    order_id BIGINT,
    user_id BIGINT,
    store_id BIGINT,
    status STRING,
    total_amount DECIMAL(14, 2),
    created_at TIMESTAMP
) PARTITIONED BY (dt STRING) STORED AS PARQUET;

DROP TABLE IF EXISTS ods_crm.ods_order_item_all_d;
CREATE TABLE ods_crm.ods_order_item_all_d (
    item_id BIGINT,
    order_id BIGINT,
    product_id BIGINT,
    quantity INT,
    price DECIMAL(10, 2)
) PARTITIONED BY (dt STRING) STORED AS PARQUET;

DROP TABLE IF EXISTS dm_crm.dm_store_product_sales_d;
CREATE TABLE dm_crm.dm_store_product_sales_d (
    dt STRING COMMENT '交易日期 yyyyMMdd',
    store_id BIGINT,
    store_name STRING,
    product_id BIGINT,
    product_name STRING,
    sales_qty BIGINT,
    sales_amount DECIMAL(16, 2)
) STORED AS PARQUET;
