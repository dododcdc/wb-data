package com.wb.wbdataback.service;

import com.wb.wbdataback.bean.db.WbRule;
import com.zaxxer.hikari.HikariDataSource;

import javax.sql.DataSource;
import java.util.List;
import java.util.Map;

public interface Query {

    public Double exec(WbRule wbRule);

    List<Map<String, Object>> select(long sourceId , String sql) throws Exception;






}
