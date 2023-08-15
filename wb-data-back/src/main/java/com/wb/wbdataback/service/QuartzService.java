package com.wb.wbdataback.service;

import org.quartz.SchedulerException;
import org.springframework.scheduling.quartz.QuartzJobBean;

public interface QuartzService {


    void addJob(
                 Class<? extends QuartzJobBean> jobClass
                , String cron
                ,Long ruleId
    ) throws SchedulerException;


    // 暂停某个job

    void pauseJob(String jobName, String jobGroupName) throws SchedulerException;

    // 重新启动某个job
    void resumeJob(String jobName, String jobGroupName) throws SchedulerException;


    // 删除某个job

    void deleteJob(String jobName, String jobGroupName) throws SchedulerException;


    // 删除所有job

    void clear() throws Exception ;

    // 暂停多个job

    // 重新启动多个job

    // 暂停所有job

    // 启动所有暂停中的job




}
