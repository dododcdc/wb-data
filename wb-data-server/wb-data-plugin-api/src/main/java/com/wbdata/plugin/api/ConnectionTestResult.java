package com.wbdata.plugin.api;

public record ConnectionTestResult(
        boolean success,
        String message
) {
    public static ConnectionTestResult success(String message) {
        return new ConnectionTestResult(true, message);
    }

    public static ConnectionTestResult failure(String message) {
        return new ConnectionTestResult(false, message);
    }
}
