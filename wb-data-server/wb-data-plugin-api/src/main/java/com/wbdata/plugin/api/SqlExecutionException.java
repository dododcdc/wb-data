package com.wbdata.plugin.api;

public class SqlExecutionException extends DataSourceException {

    private final int statementIndex;

    public SqlExecutionException(int statementIndex, Throwable cause) {
        super(statementIndex == 0 ? "SQL 执行连接失败" : "SQL 语句执行失败", cause);
        this.statementIndex = statementIndex;
    }

    // 1-based；连接建立或初始化失败时为 0。
    public int getStatementIndex() {
        return statementIndex;
    }
}
