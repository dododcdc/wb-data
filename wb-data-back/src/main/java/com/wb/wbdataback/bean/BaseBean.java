package com.wb.wbdataback.bean;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.sql.Timestamp;


@Data
@AllArgsConstructor
@NoArgsConstructor
public class BaseBean {

    private Timestamp create_time;
    private Timestamp update_time;
    private String create_by;
    private String update_by;
    private int deleted;
}
