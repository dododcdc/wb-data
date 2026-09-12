-- wb_query_export_task 从未被代码使用（导出任务为内存态），删除该死表。
-- 导出任务的临时文件清理由 QueryExportServiceImpl 的 TTL 淘汰负责。
DROP TABLE IF EXISTS wb_query_export_task;
