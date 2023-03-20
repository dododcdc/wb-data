package com.wb.wbdataback.bean.db;


import com.wb.wbdataback.bean.BaseBean;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import javax.persistence.Column;
import javax.persistence.Entity;

@Entity
@Data
@AllArgsConstructor
@NoArgsConstructor
public class WbRule extends BaseBean {

    @Column(name = "rule_name")
    private String name;
    @Column(name = "rule_desc")
    private String desc;
    @Column(name = "rule_sql")
    private String rule;


}
