package com.wb.wbdataback.controller;


import com.wb.wbdataback.bean.db.WbRule;
import com.wb.wbdataback.bean.db.WbRuleResult;
import com.wb.wbdataback.bean.request.PageEntity;
import com.wb.wbdataback.service.Query;

import com.wb.wbdataback.service.WbRuleResultRepo;
import com.wb.wbdataback.utils.WbResult;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/rule-result")
public class RuleResultController {


    @Autowired
    private Query query;

    @Autowired
    private WbRuleResultRepo wbRuleResultRepo;


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


    @PostMapping("/page")
    public WbResult page(@RequestBody PageEntity page) {

        try {
            Page<WbRuleResult> data = wbRuleResultRepo.findAll(PageRequest.of(page.getPage()-1, page.getSize(), Sort.by(Sort.Direction.DESC, "updateTime")));
            return WbResult.builder().code("200").msg("成功").data(data).build();
        } catch (Exception e) {
            e.printStackTrace();
            return WbResult.failed();
        }

    }




}
