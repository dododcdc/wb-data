package com.wbdata.query.service;

import com.wbdata.plugin.api.QueryResult;
import com.wbdata.plugin.api.QueryRowHandler;
import com.wbdata.plugin.api.QueryStreamSummary;

public interface QueryService {
    QueryResult executeQuery(Long dataSourceId, String sql, String database);

    QueryResult executeQuery(Long dataSourceId, String sql, String database, Integer rowLimit);

    QueryStreamSummary streamQuery(Long dataSourceId, String sql, String database, Integer rowLimit,
                                   QueryRowHandler rowHandler);
}
