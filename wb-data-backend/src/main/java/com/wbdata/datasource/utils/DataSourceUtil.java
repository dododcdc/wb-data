package com.wbdata.datasource.utils;

import java.sql.Connection;
import java.sql.DriverManager;
import java.util.Map;

public class DataSourceUtil {

    public static boolean testMySQLConnection(String host, Integer port, String database, String username,
            String password, Map<String, Object> params) {
        String portStr = port != null ? port.toString() : "3306";
        String jdbcParams = params != null ? (String) params.get("jdbcParams") : null;

        String url = String.format("jdbc:mysql://%s:%s/%s?%s", host, portStr, database,
                jdbcParams != null ? jdbcParams : "useSSL=false&serverTimezone=UTC");

        try (Connection ignored = DriverManager.getConnection(url, username, password)) {
            return true;
        } catch (Exception e) {
            // In a real project, we would log this error
            return false;
        }
    }
}
