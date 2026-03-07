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


    @Override
    public java.util.List<TableMetadata> getTables(ConnectionTestRequest request) {
        java.util.List<TableMetadata> tables = new java.util.ArrayList<>();
        try {
            registerDriverIfNeeded(driverClassName(), getClass().getClassLoader());
            try (Connection connection = DriverManager.getConnection(
                    buildJdbcUrl(request),
                    emptyIfNull(request.username()),
                    emptyIfNull(request.password()))) {
                
                java.sql.DatabaseMetaData metaData = connection.getMetaData();
                try (java.sql.ResultSet rs = metaData.getTables(connection.getCatalog(), null, "%", new String[]{"TABLE", "VIEW"})) {
                    while (rs.next()) {
                        String tableName = rs.getString("TABLE_NAME");
                        String tableType = rs.getString("TABLE_TYPE");
                        String remarks = rs.getString("REMARKS");
                        
                        java.util.List<ColumnMetadata> columns = new java.util.ArrayList<>();
                        try (java.sql.ResultSet columnRs = metaData.getColumns(connection.getCatalog(), null, tableName, "%")) {
                            while (columnRs.next()) {
                                columns.add(new ColumnMetadata(
                                    columnRs.getString("COLUMN_NAME"),
                                    columnRs.getString("TYPE_NAME"),
                                    columnRs.getInt("COLUMN_SIZE"),
                                    columnRs.getInt("NULLABLE") == java.sql.DatabaseMetaData.columnNullable,
                                    columnRs.getString("REMARKS"),
                                    false // Primary key needs separate call
                                ));
                            }
                        }
                        tables.add(new TableMetadata(tableName, tableType, remarks, columns));
                    }
                }
            }
        } catch (Exception exception) {
            throw new RuntimeException("Failed to fetch tables", exception);
        }
        return tables;
    }

    @Override
    public QueryResult executeQuery(QueryRequest request) {
        long startTime = System.currentTimeMillis();
        try {
            registerDriverIfNeeded(driverClassName(), getClass().getClassLoader());
            ConnectionTestRequest connectionInfo = new ConnectionTestRequest(
                request.type(), request.host(), request.port(), request.databaseName(), 
                request.username(), request.password(), request.connectionParams()
            );
            
            try (Connection connection = DriverManager.getConnection(
                    buildJdbcUrl(connectionInfo),
                    emptyIfNull(request.username()),
                    emptyIfNull(request.password()));
                 java.sql.Statement statement = connection.createStatement()) {
                
                boolean hasResultSet = statement.execute(request.sql());
                if (hasResultSet) {
                    try (java.sql.ResultSet rs = statement.getResultSet()) {
                        java.sql.ResultSetMetaData rsMetaData = rs.getMetaData();
                        int columnCount = rsMetaData.getColumnCount();
                        
                        java.util.List<ColumnMetadata> columns = new java.util.ArrayList<>();
                        for (int i = 1; i <= columnCount; i++) {
                            columns.add(new ColumnMetadata(
                                rsMetaData.getColumnName(i),
                                rsMetaData.getColumnTypeName(i),
                                rsMetaData.getPrecision(i),
                                rsMetaData.isNullable(i) != java.sql.ResultSetMetaData.columnNoNulls,
                                "",
                                false
                            ));
                        }
                        
                        java.util.List<java.util.Map<String, Object>> rows = new java.util.ArrayList<>();
                        while (rs.next()) {
                            java.util.Map<String, Object> row = new java.util.LinkedHashMap<>();
                            for (int i = 1; i <= columnCount; i++) {
                                row.put(rsMetaData.getColumnName(i), rs.getObject(i));
                            }
                            rows.add(row);
                        }
                        
                        return new QueryResult(columns, rows, System.currentTimeMillis() - startTime, "Success");
                    }
                } else {
                    int updateCount = statement.getUpdateCount();
                    return new QueryResult(java.util.Collections.emptyList(), java.util.Collections.emptyList(), 
                        System.currentTimeMillis() - startTime, "Affected rows: " + updateCount);
                }
            }
        } catch (Exception exception) {
            return new QueryResult(java.util.Collections.emptyList(), java.util.Collections.emptyList(), 
                System.currentTimeMillis() - startTime, "Error: " + exception.getMessage());
        }
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
