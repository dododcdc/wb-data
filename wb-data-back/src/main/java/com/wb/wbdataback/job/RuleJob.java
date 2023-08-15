package com.wb.wbdataback.job;

import com.wb.wbdataback.bean.db.WbRule;
import com.wb.wbdataback.service.Query;
import com.wb.wbdataback.service.WbRuleRepo;
import com.wb.wbdataback.utils.SpringUtils;
import org.quartz.JobExecutionContext;
import org.quartz.JobExecutionException;
import org.springframework.scheduling.quartz.QuartzJobBean;
import org.springframework.stereotype.Component;

import java.util.Optional;

@Component
public class RuleJob extends QuartzJobBean {




    @Override
    protected void executeInternal(JobExecutionContext context) throws JobExecutionException {

        Object ruleId = context.getJobDetail().getJobDataMap().get("rule_id");

        try {
            WbRuleRepo wbRuleRepo = (WbRuleRepo)SpringUtils.getBean("wbRuleRepo");

            Optional<WbRule> wbrule = wbRuleRepo.findById((Long) ruleId);

            System.out.println(wbrule.get());

            Query query = (Query)SpringUtils.getBean("queryImpl");

            query.exec(wbrule.get());

        } catch (Exception e) {
            throw new RuntimeException(e);
        }

        System.out.println("测试调度：" + ruleId);

    }


}
