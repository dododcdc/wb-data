package com.wb.wbdataback.service.impl;


import com.wb.wbdataback.service.QuartzService;
import org.quartz.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.quartz.QuartzJobBean;
import org.springframework.stereotype.Service;

@Service
public class QuartzServiceImpl implements QuartzService {

    @Autowired
    private Scheduler scheduler;


    @Override
    public void addJob(
             Class<? extends QuartzJobBean> jobClass
            , String cron
            ,Long ruleId) throws SchedulerException {

        String jobName = "job_rule" + ruleId;
        String jobGroupName = "job_rule" ;

        String triggerName = "tr_rule" + ruleId;
        String triggerGroupName = "tr_rule" ;

        JobDetail jobDetail = JobBuilder.newJob(jobClass).withIdentity(jobName, jobGroupName).build();
        jobDetail.getJobDataMap().put("rule_id", ruleId);

        CronTrigger cronTrigger = TriggerBuilder
                .newTrigger()
                .withIdentity(triggerName, triggerGroupName)
                .withSchedule(CronScheduleBuilder.cronSchedule(cron)).build();
        scheduler.scheduleJob(jobDetail, cronTrigger);

    }

    @Override
    public void pauseJob(String jobName, String jobGroupName) throws SchedulerException {
        scheduler.pauseJob(JobKey.jobKey(jobName, jobGroupName));

    }

    @Override
    public void resumeJob(String jobName, String jobGroupName) throws SchedulerException {
        scheduler.resumeJob(JobKey.jobKey(jobName,jobGroupName));
    }

    @Override
    public void deleteJob(String jobName, String jobGroupName) throws SchedulerException {

        scheduler.deleteJob(JobKey.jobKey(jobName, jobGroupName));


    }


    @Override
    public void clear() throws Exception {

        scheduler.clear();

    }
}
