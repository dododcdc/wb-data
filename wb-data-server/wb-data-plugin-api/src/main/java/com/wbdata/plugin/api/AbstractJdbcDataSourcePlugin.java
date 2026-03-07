package com.wbdata.plugin.api;

import java.sql.Connection;
import java.sql.Driver;
import java.sql.DriverManager;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

public abstract class AbstractJdbcDataSourcePlugin implements DataSourcePlugin {

    private static final Set<String> REGISTERED_DRIVERS = ConcurrentHashMap.newKeySet();

    protected abstract String driverClassName();

    protected abstract String buildJdbcUrl(ConnectionTestRequest request);

    @Override
    public boolean testConnection(ConnectionTestRequest request) {
        try {
            registerDriverIfNeeded(driverClassName(), getClass().getClassLoader());
            try (Connection ignored = DriverManager.getConnection(
                    buildJdbcUrl(request),
                    emptyIfNull(request.username()),
                    emptyIfNull(request.password()))) {
                return true;
            }
        } catch (Exception exception) {
            return false;
        }
    }

    protected String emptyIfNull(String value) {
        return value == null ? "" : value;
    }

    protected String defaultPort(Integer port, String fallback) {
        return port == null ? fallback : String.valueOf(port);
    }

    protected String defaultDatabase(String databaseName, String fallback) {
        return databaseName == null || databaseName.isBlank() ? fallback : databaseName;
    }

    protected String connectionParam(Map<String, Object> params, String key) {
        if (params == null || key == null) {
            return null;
        }

        Object value = params.get(key);
        if (value == null) {
            return null;
        }

        String stringValue = String.valueOf(value).trim();
        return stringValue.isEmpty() ? null : stringValue;
    }

    private void registerDriverIfNeeded(String driverClassName, ClassLoader classLoader) throws Exception {
        String registrationKey = driverClassName + '@' + System.identityHashCode(classLoader);
        if (REGISTERED_DRIVERS.contains(registrationKey)) {
            return;
        }

        synchronized (REGISTERED_DRIVERS) {
            if (REGISTERED_DRIVERS.contains(registrationKey)) {
                return;
            }

            Driver driver = (Driver) Class.forName(driverClassName, true, classLoader)
                    .getDeclaredConstructor()
                    .newInstance();
            DriverManager.registerDriver(new DriverShim(driver));
            REGISTERED_DRIVERS.add(registrationKey);
        }
    }
}
