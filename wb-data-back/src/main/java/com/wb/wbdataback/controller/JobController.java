package com.wb.wbdataback.controller;

import com.wb.wbdataback.bean.request.JobMsg;
import com.wb.wbdataback.job.RuleJob;
import com.wb.wbdataback.service.QuartzService;
import com.wb.wbdataback.utils.WbResult;
import org.quartz.JobKey;
import org.quartz.SchedulerException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/job")
public class JobController {

    @Autowired
    private QuartzService quartzService;


    @PostMapping("/add")
    public WbResult add(@RequestBody JobMsg jobMsg){


        try {
            quartzService.addJob(RuleJob.class,jobMsg.getCron(),jobMsg.getRuleId());
        } catch (SchedulerException e) {

            e.printStackTrace();
            return WbResult.failed();

        }

        return WbResult.success();
    }


    @GetMapping("/del")
    public WbResult del(Long ruleId) {
        String jobName = "job_rule" + ruleId;
        String jobGroupName = "job_rule" ;

        try {
            quartzService.deleteJob(jobName,jobGroupName);
        } catch (SchedulerException e) {
            e.printStackTrace();
            return WbResult.failed();
        }

        return WbResult.success();

    }


    @GetMapping("/getCron")
    public WbResult getCron(Long ruleId) {
        String jobName = "job_rule" + ruleId;
        String jobGroupName = "job_rule" ;

        JobKey jobKey = new JobKey(jobName, jobGroupName);

        try {
            String cron = quartzService.getCron(jobKey);
            return WbResult.builder().code("200")
                    .msg("成功")
                    .data(cron)
                    .build();

        }catch (Exception e) {
            e.printStackTrace();
            return WbResult.failed();
        }

    }

    @GetMapping("updateCron")
    public WbResult updateCron(Long ruleId,String cron){
        String jobName = "job_rule" + ruleId;
        String jobGroupName = "job_rule" ;

        JobKey jobKey = new JobKey(jobName, jobGroupName);

        try {

            quartzService.updateCron(jobKey,cron);

            return WbResult.success();



        }catch (Exception e) {
            e.printStackTrace();
            return WbResult.failed();
        }



    }

    @GetMapping("/clear")
    public WbResult clear() {

        try {
            quartzService.clear();
        } catch (Exception e) {
            e.printStackTrace();
            return WbResult.failed();
        }

        return WbResult.success();
    }


}
