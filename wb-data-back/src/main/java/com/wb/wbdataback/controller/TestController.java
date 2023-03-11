package com.wb.wbdataback.controller;


import com.wb.wbdataback.bean.db.WbSource;
import com.wb.wbdataback.service.WbSourceRepo;
import com.wb.wbdataback.utils.WbResult;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;


import java.util.List;

@RestController
@RequestMapping("/t")
public class TestController {


    @Autowired
    private WbSourceRepo wbSourceRepo;




    @RequestMapping("/test1")
    public WbResult test1() {


        return WbResult.success();

    }


    /**
     * 查询分页
     * @param req
     * @return
     */
    @RequestMapping("/test3")
    public WbResult test3(Pageable req) {

        Page<WbSource> all = wbSourceRepo.findAll(req);

        return new WbResult("200","成功",all);
    }


}
