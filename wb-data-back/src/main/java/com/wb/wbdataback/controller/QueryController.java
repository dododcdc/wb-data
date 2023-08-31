package com.wb.wbdataback.controller;


import com.wb.wbdataback.bean.request.ExecParam;
import com.wb.wbdataback.service.Query;
import com.wb.wbdataback.utils.WbResult;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/query")
public class QueryController {

    @Autowired
    private Query query;

    @PostMapping("/exec")
    public WbResult exec(@RequestBody ExecParam execParam) {

        try{

            List<Map<String, Object>> data = query.select(execParam.getDbId(), execParam.getSql());

            return new WbResult("200","成功",data);


        }catch (Exception e){

            e.printStackTrace();

            return WbResult.failed();

        }



    }


}
