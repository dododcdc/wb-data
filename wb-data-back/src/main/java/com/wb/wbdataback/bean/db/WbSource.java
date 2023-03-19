package com.wb.wbdataback.bean.db;


import com.wb.wbdataback.bean.BaseBean;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import javax.persistence.Entity;
import javax.persistence.GeneratedValue;
import javax.persistence.GenerationType;
import javax.persistence.Id;

import java.sql.Timestamp;


@Entity
@Data
@AllArgsConstructor
@NoArgsConstructor

public class WbSource  {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id ;

    private String type;
    private String url;
    private String username;
    private String password;
    private String db_name;
    private Timestamp create_time;
    private Timestamp update_time;
    private String create_by;
    private String update_by;
    private int deleted;


}
