package com.wb.wbdataback.controller;


import com.wb.wbdataback.bean.db.WbSource;
import com.wb.wbdataback.service.WbSourceRepo;
import com.wb.wbdataback.utils.WbResult;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/db")
public class DbController {

    @Autowired
    private WbSourceRepo wbSourceRepo;


    @PostMapping("/add")
    public WbResult add(@RequestBody WbSource wbSource) {

        try{

            wbSourceRepo.save(wbSource);
        }catch (Exception e) {

            e.printStackTrace();

            return WbResult.failed();

        }

        return WbResult.success();

    }

    @DeleteMapping("/del/{id}")
    public WbResult del(@PathVariable("id") Long  id) {

        try{
            wbSourceRepo.deleteById(id);

        }catch (Exception e) {


            e.printStackTrace();

            return WbResult.failed();
        }

        return WbResult.success();
    }

    @GetMapping("/all")
    public WbResult all() {

        List<WbSource> data = wbSourceRepo.findAll();

        return new WbResult("200","成功",data);

    }



}
