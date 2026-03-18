package com.wbdata.plugin.api;

/**
 * 数据源操作相关的业务异常
 */
public class DataSourceException extends RuntimeException {


    public DataSourceException(String message, Throwable cause) {
        super(message, cause);
    }
}
