DROP TABLE IF EXISTS transfer_orders_source;
CREATE TABLE transfer_orders_source (
    order_id BIGINT,
    customer_name STRING,
    amount DECIMAL(12, 2),
    date_key DATE,
    dayno STRING
) STORED AS PARQUET;

INSERT INTO transfer_orders_source VALUES
    (2001, 'Dina', 44.10, DATE '2026-07-01', '20260701'),
    (2002, 'Evan', 78.40, DATE '2026-07-02', '20260702');

DROP TABLE IF EXISTS transfer_orders_target;
CREATE TABLE transfer_orders_target (
    order_id BIGINT,
    customer_name STRING,
    amount DECIMAL(12, 2),
    date_key DATE,
    dayno STRING
) STORED AS PARQUET;

INSERT INTO transfer_orders_target VALUES
    (2999, 'existing-target-row', 1.00, DATE '2026-06-30', '20260630');

DROP TABLE IF EXISTS transfer_orders_partitioned_target;
CREATE TABLE transfer_orders_partitioned_target (
    order_id BIGINT,
    customer_name STRING,
    amount DECIMAL(12, 2),
    date_key DATE
) PARTITIONED BY (dayno STRING) STORED AS PARQUET;

INSERT INTO transfer_orders_partitioned_target PARTITION (dayno = '20260701') VALUES
    (2998, 'existing-partition-row', 1.00, DATE '2026-07-01');
