package com.wb.wbdataback.utils;


import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
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



    public static WbResult success() {
        return SUCCESS;
    }

    public static WbResult failed() {
        return FAILED;
    }



}
