-- CRM 场景测试：ClickHouse 结果表
-- 用法: docker exec -i wb-data-clickhouse clickhouse-client --user wbdata --password <密码> --multiquery < scripts/dev/init/crm/clickhouse/001_schema.sql
DROP TABLE IF EXISTS default.dm_store_product_sales_d;
CREATE TABLE default.dm_store_product_sales_d (
    dt String,
    store_id Int64,
    store_name String,
    product_id Int64,
    product_name String,
    sales_qty Int64,
    sales_amount Decimal(16, 2)
) ENGINE = MergeTree
ORDER BY (dt, store_id, product_id);
