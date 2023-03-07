package com.wb.wbdataback.controller;


import com.wb.wbdataback.utils.WbResult;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/t")
public class TestController {



    @RequestMapping("/test1")
    public WbResult test1() {


        return WbResult.success();

    }


}
