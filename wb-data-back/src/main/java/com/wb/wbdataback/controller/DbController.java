package com.wb.wbdataback.controller;


import com.wb.wbdataback.bean.db.WbSource;
import com.wb.wbdataback.service.WbSourceRepo;
import com.wb.wbdataback.utils.WbResult;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/db")
public class DbController {

    @Autowired
    private WbSourceRepo wbSourceRepo;


    @PostMapping("/add")
    public WbResult add(@RequestBody WbSource wbSource) {

        wbSourceRepo.save(wbSource);

        return WbResult.success();

    }
}
