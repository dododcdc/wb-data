CREATE TABLE transfer_orders_source (
    order_id BIGINT NOT NULL,
    customer_name VARCHAR(100) NOT NULL,
    amount DECIMAL(12, 2) NOT NULL,
    date_key DATE NOT NULL,
    dayno VARCHAR(8) NOT NULL,
    PRIMARY KEY (order_id)
);

INSERT INTO transfer_orders_source (order_id, customer_name, amount, date_key, dayno) VALUES
    (1001, 'Ada', 125.50, '2026-07-01', '20260701'),
    (1002, 'Ben', 89.25, '2026-07-01', '20260701'),
    (1003, 'Chen', 210.00, '2026-07-02', '20260702');

CREATE TABLE transfer_orders_target (
    order_id BIGINT NOT NULL,
    customer_name VARCHAR(100) NOT NULL,
    amount DECIMAL(12, 2) NOT NULL,
    date_key DATE NOT NULL,
    dayno VARCHAR(8) NOT NULL,
    PRIMARY KEY (order_id)
);

INSERT INTO transfer_orders_target (order_id, customer_name, amount, date_key, dayno) VALUES
    (9999, 'existing-target-row', 1.00, '2026-06-30', '20260630');
