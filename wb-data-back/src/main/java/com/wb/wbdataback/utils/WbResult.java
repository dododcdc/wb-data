package com.wb.wbdataback.utils;


import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class WbResult {

    private static WbResult SUCCESS;
    private static WbResult FAILED;

    static  {
        SUCCESS = new WbResult("200","成功",null);
        FAILED = new WbResult("500","失败",null);
    }

    private String code;

    private String msg;

    private Object data;


    public  WbResult(String code,String msg) {
        this(code,msg,null);
    }

    public  WbResult(String code) {
        this(code,"",null);
    }

    public static WbResult success() {
        return SUCCESS;
    }

    public static WbResult failed() {
        return FAILED;
    }

}
