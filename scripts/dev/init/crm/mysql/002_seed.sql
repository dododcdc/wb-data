-- CRM 场景测试：确定性造数（可重复执行，先清后插）
-- user 100 / store 10 / product 50 / orders 5000 / order_item 约 12500
-- orders.created_at 分布最近 7 天，便于聚合验证
USE crm_demo;

SET FOREIGN_KEY_CHECKS = 0;
TRUNCATE TABLE order_item;
TRUNCATE TABLE orders;
TRUNCATE TABLE product;
TRUNCATE TABLE store;
TRUNCATE TABLE user;
SET FOREIGN_KEY_CHECKS = 1;

INSERT INTO store (store_id, name, city, region)
SELECT
    n,
    CONCAT('门店', LPAD(n, 2, '0')),
    ELT(1 + n % 5, '杭州', '上海', '北京', '深圳', '成都'),
    ELT(1 + n % 3, '华东', '华北', '华南')
FROM (
    SELECT a.x + 1 AS n
    FROM (SELECT 0 x UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4
          UNION SELECT 5 UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9) a
) seq;

INSERT INTO product (product_id, name, category, price)
SELECT
    2000 + n,
    CONCAT('商品', LPAD(n, 3, '0')),
    ELT(1 + n % 6, '饮料', '零食', '日化', '生鲜', '数码', '服饰'),
    ROUND(5 + (n * 37 % 500) + (n % 100) / 100.0, 2)
FROM (
    SELECT a.x + b.x * 10 + 1 AS n
    FROM (SELECT 0 x UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4
          UNION SELECT 5 UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9) a
    CROSS JOIN (SELECT 0 x UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4
          UNION SELECT 5 UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9) b
) seq;

INSERT INTO user (user_id, name, gender, city, level, created_at)
SELECT
    1000 + n,
    CONCAT('客户', LPAD(n, 3, '0')),
    IF(n % 2 = 0, 'F', 'M'),
    ELT(1 + n % 5, '杭州', '上海', '北京', '深圳', '成都'),
    1 + n % 5,
    DATE_SUB(NOW(), INTERVAL 30 + n DAY)
FROM (
    SELECT a.x + b.x * 10 + 1 AS n
    FROM (SELECT 0 x UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4
          UNION SELECT 5 UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9) a
    CROSS JOIN (SELECT 0 x UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4
          UNION SELECT 5 UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9) b
) seq;

INSERT INTO orders (order_id, user_id, store_id, status, total_amount, created_at)
SELECT
    100000 + n,
    1000 + (1 + n % 100),
    1 + n % 10,
    ELT(1 + n % 10, 'COMPLETED', 'COMPLETED', 'COMPLETED', 'COMPLETED', 'COMPLETED',
        'COMPLETED', 'COMPLETED', 'COMPLETED', 'PAID', 'CANCELLED'),
    0,
    DATE_ADD(DATE_ADD(DATE_SUB(CURDATE(), INTERVAL n % 7 DAY), INTERVAL n % 24 HOUR), INTERVAL n % 60 MINUTE)
FROM (
    SELECT a.x + b.x * 10 + c.x * 100 + d.x * 1000 + 1 AS n
    FROM (SELECT 0 x UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4
          UNION SELECT 5 UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9) a
    CROSS JOIN (SELECT 0 x UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4
          UNION SELECT 5 UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9) b
    CROSS JOIN (SELECT 0 x UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4
          UNION SELECT 5 UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9) c
    CROSS JOIN (SELECT 0 x UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4) d
) seq;

-- 每单 1~4 行明细
INSERT INTO order_item (item_id, order_id, product_id, quantity, price)
SELECT
    1000000 + ROW_NUMBER() OVER (ORDER BY o.order_id, k.k),
    o.order_id,
    2000 + (1 + (o.order_id + k.k * 7) % 50),
    1 + (o.order_id + k.k) % 5,
    p.price
FROM orders o
JOIN (
    SELECT 1 k UNION SELECT 2 UNION SELECT 3 UNION SELECT 4
) k ON k.k <= 1 + (o.order_id % 4)
JOIN product p ON p.product_id = 2000 + (1 + (o.order_id + k.k * 7) % 50);

UPDATE orders o
JOIN (SELECT order_id, SUM(quantity * price) amt FROM order_item GROUP BY order_id) t
    ON t.order_id = o.order_id
SET o.total_amount = t.amt;
