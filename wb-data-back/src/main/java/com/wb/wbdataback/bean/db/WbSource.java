package com.wb.wbdataback.bean.db;


import com.wb.wbdataback.bean.BaseBean;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import javax.persistence.Entity;


@Entity
@Data
@AllArgsConstructor
@NoArgsConstructor

public class WbSource extends BaseBean  {


    private String type;
    private String url;
    private String username;
    private String password;
    private String dbName;


}
