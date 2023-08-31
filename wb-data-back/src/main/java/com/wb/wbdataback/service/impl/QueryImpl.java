package com.wb.wbdataback.service.impl;

import com.mchange.v2.c3p0.DriverManagerDataSource;
import com.wb.wbdataback.bean.db.WbRule;
import com.wb.wbdataback.bean.db.WbRuleResult;
import com.wb.wbdataback.bean.db.WbSource;
import com.wb.wbdataback.service.Query;
import com.wb.wbdataback.service.WbRuleResultRepo;
import com.wb.wbdataback.service.WbSourceRepo;
import com.zaxxer.hikari.HikariDataSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.jdbc.DataSourceBuilder;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.util.Assert;

import javax.sql.DataSource;
import java.sql.SQLException;
import java.util.List;
import java.util.Map;
import java.util.Optional;


@Service
public class QueryImpl implements Query {

    @Autowired
    private WbRuleResultRepo wbRuleResultRepo;

    @Autowired
    private WbSourceRepo wbSourceRepo;

    private DriverManagerDataSource dataSource;
    private JdbcTemplate jdbcTemplate;


    @Override
    public Double exec(WbRule wbRule) {

        Long wbSourceId = wbRule.getWbSourceId();
        Optional<WbSource> wbSource = wbSourceRepo.findById(wbSourceId);


        String url = wbSource.get().getUrl();
        String username = wbSource.get().getUsername();
        String password = wbSource.get().getPassword();
        String driverClassName = wbSource.get().getDriverClassName();
        dataSource = new DriverManagerDataSource();
        dataSource.setJdbcUrl(url);
        dataSource.setUser(username);
        dataSource.setPassword(password);
        dataSource.setDriverClass(driverClassName);


        JdbcTemplate jdbcTemplate = new JdbcTemplate(dataSource);

        // 结果值
        Double res = jdbcTemplate.queryForObject(wbRule.getRuleSql(), Double.class);
        // 阈值
        Double threshold = wbRule.getThreshold();
        // 操作符
        String operator = wbRule.getOperator();

        // 结果值 运算符 阈值 = true 则异常 isException = 1

        int isException = isException(res, threshold, operator);


        wbRuleResultRepo.save(WbRuleResult.builder()
                .wbRuleId(wbRule.getId())
                .result(res)
                .isException(isException)
                .build());


        return res;
    }

    @Override
    public  List<Map<String, Object>> select(long sourceId, String sql) {

        // 根据用户传入的数据源初始化datasource
        Optional<WbSource> wbSource = wbSourceRepo.findById(sourceId);
        String url = wbSource.get().getUrl();
        String username = wbSource.get().getUsername();
        String password = wbSource.get().getPassword();
        String driverClassName = wbSource.get().getDriverClassName();
        dataSource = new DriverManagerDataSource();
        dataSource.setJdbcUrl(url);
        dataSource.setUser(username);
        dataSource.setPassword(password);
        dataSource.setDriverClass(driverClassName);

        this.jdbcTemplate = new JdbcTemplate(dataSource);

        sql = sql + " limit 50";

        // 执行sql
        List<Map<String, Object>> maps = jdbcTemplate.queryForList(sql);

        return maps;
    }


    private int isException(Double res, Double threshold, String operator) {

        Assert.notNull(res, "sql结果为空");
        Assert.notNull(threshold, "阈值为空");
        Assert.notNull(operator, "操作符为空");

        switch (operator) {
            case ">":
                return res > threshold ? 1 : 0;
            case "<":
                return res < threshold ? 1 : 0;
            case ">=":
                return res >= threshold ? 1 : 0;
            case "<=":
                return res <= threshold ? 1 : 0;
            case "=":
                return res == threshold ? 1 : 0;
            default:
                return 1;
        }

    }

}
