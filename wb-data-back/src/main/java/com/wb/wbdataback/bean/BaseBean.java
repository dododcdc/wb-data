package com.wb.wbdataback.bean;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import lombok.experimental.Accessors;
import org.hibernate.annotations.Generated;
import org.hibernate.annotations.GenerationTime;

import javax.persistence.*;
import java.sql.Timestamp;



@Data
@AllArgsConstructor
@NoArgsConstructor
@MappedSuperclass
public class BaseBean {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id ;


    @Column(name = "create_time", insertable = false, updatable = false)
    @Generated(value = GenerationTime.INSERT)
    private Timestamp createTime;
    @Column(name = "update_time", insertable = false, updatable = false)
    @Generated(value = GenerationTime.ALWAYS)
    private Timestamp updateTime;
    private String create_by;
    private String update_by;
    private int deleted;
}
