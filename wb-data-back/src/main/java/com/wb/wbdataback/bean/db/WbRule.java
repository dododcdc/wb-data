package com.wb.wbdataback.bean.db;


import com.wb.wbdataback.bean.BaseBean;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import javax.persistence.*;

@Entity
@Data
@AllArgsConstructor
@NoArgsConstructor
public class WbRule extends BaseBean {


    private Long wbSourceId;
    @Column(name = "name")
    private String name;
    @Column(name = "detail")
    private String detail;
    @Column(name = "rule_sql")
    private String ruleSql;

    private Double threshold ;

    private String operator;

//    @ManyToOne(fetch = FetchType.LAZY)
//    private WbSource wbSource;




}
