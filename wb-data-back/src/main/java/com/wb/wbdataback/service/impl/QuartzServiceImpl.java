package com.wb.wbdataback.service.impl;


import com.wb.wbdataback.service.QuartzService;
import org.quartz.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.quartz.QuartzJobBean;
import org.springframework.stereotype.Service;

import java.util.List;

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
    public String getCron(JobKey jobKey) throws SchedulerException {

        List<? extends Trigger> triggersOfJob = scheduler.getTriggersOfJob(jobKey);

        if (triggersOfJob.size()>0) {

            Trigger trigger = triggersOfJob.get(0);

            return  ((CronTrigger)trigger).getCronExpression();

        }
        return "";
    }

    @Override
    public void updateCron(JobKey jobKey,String cron) throws SchedulerException {

        JobDetail jobDetail = scheduler.getJobDetail(jobKey);


        if (jobDetail != null) {

            Trigger newTrigger = TriggerBuilder.newTrigger()
                    .withIdentity("tr_rule" + jobKey.getName(), "tr_rule" + jobKey.getGroup())
                    .withSchedule(CronScheduleBuilder.cronSchedule(cron)) // 设置新的 cron 表达式
                    .build();

            Trigger trigger = scheduler.getTriggersOfJob(jobKey).get(0);
            TriggerKey key = trigger.getKey();
            scheduler.rescheduleJob(key, newTrigger);

        }

    }


    @Override
    public void clear() throws Exception {

        scheduler.clear();
        System.out.println("job已经全部清除完毕1.0.1");

    }
}
