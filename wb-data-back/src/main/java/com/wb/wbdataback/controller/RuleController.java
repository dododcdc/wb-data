package com.wb.wbdataback.controller;


import com.wb.wbdataback.bean.db.WbRule;
import com.wb.wbdataback.bean.request.PageEntity;
import com.wb.wbdataback.service.WbRuleRepo;
import com.wb.wbdataback.utils.WbResult;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/rule")
public class RuleController {

    @Autowired
    private WbRuleRepo wbRuleRepo;

    @PostMapping("/add")
    public WbResult add(@RequestBody WbRule wbRule) {

        try{

            wbRuleRepo.save(wbRule);

        }catch (Exception e) {

            e.printStackTrace();

            return WbResult.failed();

        }

        return WbResult.success();

    }

    @DeleteMapping("/del/{id}")
    public WbResult del(@PathVariable("id") Long  id) {
        try {
            wbRuleRepo.deleteById(id);
            return WbResult.success();
        } catch (Exception e) {
            e.printStackTrace();
            return WbResult.failed();
        }
    }

    @PostMapping("/page")
    public WbResult page(@RequestBody PageEntity page) {

        try {
            Page<WbRule> data = wbRuleRepo.findAll(PageRequest.of(page.getPage()-1, page.getSize(),Sort.by("updateTime").descending()));
            return WbResult.builder().code("200").msg("成功").data(data).build();
        } catch (Exception e) {
            e.printStackTrace();
            return WbResult.failed();
        }

    }


}
