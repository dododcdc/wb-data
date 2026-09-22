-- CRM 场景测试：第二天追加一批「今天」的订单（验证调度重跑后结果变化）
-- 用法同 001_schema.sql；可重复执行，每次在现有最大 order_id 之后追加 500 单
USE crm_demo;

INSERT INTO orders (order_id, user_id, store_id, status, total_amount, created_at)
SELECT
    base.max_id + seq.n,
    1000 + (1 + seq.n % 100),
    1 + seq.n % 10,
    ELT(1 + seq.n % 10, 'COMPLETED', 'COMPLETED', 'COMPLETED', 'COMPLETED', 'COMPLETED',
        'COMPLETED', 'COMPLETED', 'COMPLETED', 'PAID', 'CANCELLED'),
    0,
    DATE_ADD(CURDATE(), INTERVAL seq.n % 24 HOUR)
FROM (SELECT COALESCE(MAX(order_id), 100000) AS max_id FROM orders) base
CROSS JOIN (
    SELECT a.x + b.x * 10 + c.x * 100 + 1 AS n
    FROM (SELECT 0 x UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4
          UNION SELECT 5 UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9) a
    CROSS JOIN (SELECT 0 x UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4
          UNION SELECT 5 UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9) b
    CROSS JOIN (SELECT 0 x UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4) c
) seq;

INSERT INTO order_item (item_id, order_id, product_id, quantity, price)
SELECT
    (SELECT COALESCE(MAX(item_id), 1000000) FROM order_item) + ROW_NUMBER() OVER (ORDER BY o.order_id, k.k),
    o.order_id,
    2000 + (1 + (o.order_id + k.k * 7) % 50),
    1 + (o.order_id + k.k) % 5,
    p.price
FROM orders o
JOIN (
    SELECT 1 k UNION SELECT 2 UNION SELECT 3 UNION SELECT 4
) k ON k.k <= 1 + (o.order_id % 4)
JOIN product p ON p.product_id = 2000 + (1 + (o.order_id + k.k * 7) % 50)
WHERE NOT EXISTS (SELECT 1 FROM order_item oi WHERE oi.order_id = o.order_id);

UPDATE orders o
JOIN (SELECT order_id, SUM(quantity * price) amt FROM order_item GROUP BY order_id) t
    ON t.order_id = o.order_id
SET o.total_amount = t.amt
WHERE o.total_amount = 0;
