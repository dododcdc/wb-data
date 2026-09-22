-- CRM 场景测试：业务库与五张源表
-- 用法: docker compose -f docker/docker-compose.mysql.yml exec -T -e MYSQL_PWD=<密码> mysql mysql -h 127.0.0.1 -uroot < scripts/dev/init/crm/mysql/001_schema.sql
CREATE DATABASE IF NOT EXISTS crm_demo;
USE crm_demo;

DROP TABLE IF EXISTS order_item;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS product;
DROP TABLE IF EXISTS store;
DROP TABLE IF EXISTS user;

CREATE TABLE user (
    user_id BIGINT NOT NULL,
    name VARCHAR(100) NOT NULL,
    gender VARCHAR(10) NOT NULL,
    city VARCHAR(50) NOT NULL,
    level INT NOT NULL,
    created_at DATETIME NOT NULL,
    PRIMARY KEY (user_id)
);

CREATE TABLE store (
    store_id BIGINT NOT NULL,
    name VARCHAR(100) NOT NULL,
    city VARCHAR(50) NOT NULL,
    region VARCHAR(50) NOT NULL,
    PRIMARY KEY (store_id)
);

CREATE TABLE product (
    product_id BIGINT NOT NULL,
    name VARCHAR(100) NOT NULL,
    category VARCHAR(50) NOT NULL,
    price DECIMAL(10, 2) NOT NULL,
    PRIMARY KEY (product_id)
);

CREATE TABLE orders (
    order_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL,
    store_id BIGINT NOT NULL,
    status VARCHAR(20) NOT NULL,
    total_amount DECIMAL(14, 2) NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL,
    PRIMARY KEY (order_id)
);

CREATE TABLE order_item (
    item_id BIGINT NOT NULL,
    order_id BIGINT NOT NULL,
    product_id BIGINT NOT NULL,
    quantity INT NOT NULL,
    price DECIMAL(10, 2) NOT NULL,
    PRIMARY KEY (item_id)
);
