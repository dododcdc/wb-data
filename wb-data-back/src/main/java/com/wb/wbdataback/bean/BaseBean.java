package com.wb.wbdataback.bean;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import lombok.experimental.Accessors;

import javax.persistence.*;
import java.sql.Timestamp;



@Data
public class BaseBean {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id ;

    private Timestamp create_time;
    private Timestamp update_time;
    private String create_by;
    private String update_by;
    private int deleted;
}
