package com.wb.wbdataback.controller;


import com.wb.wbdataback.bean.db.WbRule;
import com.wb.wbdataback.service.Query;

import com.wb.wbdataback.utils.WbResult;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/rule-result")
public class RuleResultController {


    @Autowired
    private Query query;




    @PostMapping("/exec-rule")
    public WbResult execRule(@RequestBody WbRule wbRule) {

        try {
            query.exec(wbRule);
            return WbResult.success();
        } catch (Exception e) {
            e.printStackTrace();
            return WbResult.failed();
        }

    }


}
