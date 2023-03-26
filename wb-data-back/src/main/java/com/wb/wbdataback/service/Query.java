package com.wb.wbdataback.service;

import com.wb.wbdataback.bean.db.WbRule;
import com.zaxxer.hikari.HikariDataSource;

import javax.sql.DataSource;

public interface Query {

    public Double exec(WbRule wbRule);
}
