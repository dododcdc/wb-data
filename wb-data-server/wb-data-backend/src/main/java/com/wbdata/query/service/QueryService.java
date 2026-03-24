package com.wbdata.query.service;

import com.wbdata.plugin.api.QueryResult;

public interface QueryService {
    QueryResult executeQuery(Long dataSourceId, String sql, String database);

    QueryResult executeQuery(Long dataSourceId, String sql, String database, Integer rowLimit);
}
