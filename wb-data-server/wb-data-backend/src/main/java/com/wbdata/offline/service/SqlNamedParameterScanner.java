package com.wbdata.offline.service;

import com.wbdata.sql.SqlParameterTemplate;

import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.Set;

final class SqlNamedParameterScanner {

    Analysis scan(String sql) {
        SqlParameterTemplate.Compilation compilation = SqlParameterTemplate.compile(sql);
        return new Analysis(Collections.unmodifiableSet(
                new LinkedHashSet<>(compilation.parameterNames())));
    }

    record Analysis(Set<String> parameters) {
    }
}
