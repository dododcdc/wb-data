-- Assuming table stock_daily(stock_code string, trade_date date, close_price double)
-- Find stocks with at least 7 consecutive trading days where each day's close > previous day's close

WITH daily_flag AS (
  SELECT
    stock_code,
    trade_date,
    close_price,
    LAG(close_price) OVER (PARTITION BY stock_code ORDER BY trade_date) AS prev_close,
    CASE 
      WHEN LAG(close_price) OVER (PARTITION BY stock_code ORDER BY trade_date) IS NULL THEN 0
      WHEN close_price > LAG(close_price) OVER (PARTITION BY stock_code ORDER BY trade_date) THEN 1
      ELSE 0
    END AS is_up
  FROM stock_daily
),
streak_groups AS (
  SELECT
    stock_code,
    trade_date,
    close_price,
    is_up,
    SUM(CASE WHEN is_up = 0 THEN 1 ELSE 0 END) OVER (PARTITION BY stock_code ORDER BY trade_date ROWS UNBOUNDED PRECEDING) AS grp
  FROM daily_flag
),
streak_lengths AS (
  SELECT
    stock_code,
    grp,
    MIN(trade_date) AS start_date,
    MAX(trade_date) AS end_date,
    COUNT(*) AS streak_len
  FROM streak_groups
  WHERE is_up = 1
  GROUP BY stock_code, grp
)
SELECT
  stock_code,
  start_date,
  end_date,
  streak_len
FROM streak_lengths
WHERE streak_len >= 7
ORDER BY stock_code, start_date;
