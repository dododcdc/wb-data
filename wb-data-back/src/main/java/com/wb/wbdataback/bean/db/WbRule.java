package com.wb.wbdataback.bean.db;


import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import javax.persistence.*;
import java.sql.Timestamp;

@Entity
@Data
@AllArgsConstructor
@NoArgsConstructor
public class WbRule  {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id ;

    @Column(name = "rule_name")
    private String name;
    @Column(name = "rule_desc")
    private String desc;
    @Column(name = "rule_sql")
    private String rule;

    @Column(nullable = false, updatable = false)
    private Timestamp createTime;


    @Column(nullable = false)
    private Timestamp updateTime;

    private String createBy;
    private String updateBy;
    private int deleted;


    @PrePersist
    public void prePersist() {
        createTime = new Timestamp(System.currentTimeMillis());
        updateTime = new Timestamp(System.currentTimeMillis());
    }
}
