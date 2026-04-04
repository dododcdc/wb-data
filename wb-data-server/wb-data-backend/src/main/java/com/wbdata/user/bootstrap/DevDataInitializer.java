package com.wbdata.user.bootstrap;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.wbdata.group.entity.WbProjectGroup;
import com.wbdata.group.entity.WbProjectGroupMember;
import com.wbdata.group.mapper.WbProjectGroupMapper;
import com.wbdata.group.mapper.WbProjectGroupMemberMapper;
import com.wbdata.user.entity.WbUser;
import com.wbdata.user.mapper.WbUserMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.annotation.Order;
import org.springframework.context.annotation.Profile;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;

@Slf4j
@Component
@Order(1)
@Profile("dev")
@RequiredArgsConstructor
public class DevDataInitializer implements ApplicationRunner {

    private final WbUserMapper wbUserMapper;
    private final WbProjectGroupMapper wbProjectGroupMapper;
    private final WbProjectGroupMemberMapper wbProjectGroupMemberMapper;
    private final PasswordEncoder passwordEncoder;

    @Value("${WB_DATA_SEED_DEV_DATA:false}")
    private boolean seedDevData;

    @Value("${WB_DATA_DEV_DEFAULT_PASSWORD:Dev123456!}")
    private String defaultPassword;

    @Override
    public void run(ApplicationArguments args) {
        if (!seedDevData) {
            return;
        }

        WbUser sysAdmin = ensureUser("sys_admin", "系统管理员", "SYSTEM_ADMIN", "ACTIVE");
        WbProjectGroup alpha = ensureGroup("alpha", "默认测试项目组 alpha", sysAdmin.getId());
        WbProjectGroup beta = ensureGroup("beta", "默认测试项目组 beta", sysAdmin.getId());

        WbUser gaAlpha = ensureUser("ga_alpha", "Alpha 管理员", "USER", "ACTIVE");
        WbUser devAlpha = ensureUser("dev_alpha", "Alpha 开发者", "USER", "ACTIVE");
        WbUser gaBeta = ensureUser("ga_beta", "Beta 管理员", "USER", "ACTIVE");
        WbUser multiUser = ensureUser("multi_user", "多项目组用户", "USER", "ACTIVE");
        WbUser userNoGroup = ensureUser("user_no_group", "无项目组用户", "USER", "ACTIVE");
        WbUser userDisabled = ensureUser("user_disabled", "禁用用户", "USER", "DISABLED");

        ensureMembership(alpha.getId(), gaAlpha.getId(), "GROUP_ADMIN", sysAdmin.getId());
        ensureMembership(alpha.getId(), devAlpha.getId(), "DEVELOPER", sysAdmin.getId());
        ensureMembership(alpha.getId(), multiUser.getId(), "DEVELOPER", sysAdmin.getId());

        ensureMembership(beta.getId(), gaBeta.getId(), "GROUP_ADMIN", sysAdmin.getId());
        ensureMembership(beta.getId(), multiUser.getId(), "GROUP_ADMIN", sysAdmin.getId());

        log.info("开发测试数据已准备完成。默认开发密码适用于 sys_admin / ga_alpha / dev_alpha / ga_beta / multi_user / user_no_group / user_disabled");
        log.debug("开发测试辅助账号已创建: {}, {}", userNoGroup.getUsername(), userDisabled.getUsername());
    }

    private WbUser ensureUser(String username, String displayName, String systemRole, String status) {
        WbUser existing = wbUserMapper.selectOne(new LambdaQueryWrapper<WbUser>()
                .eq(WbUser::getUsername, username)
                .last("LIMIT 1"));
        if (existing != null) {
            return existing;
        }

        WbUser user = new WbUser();
        user.setUsername(username);
        user.setDisplayName(displayName);
        user.setPasswordHash(passwordEncoder.encode(defaultPassword));
        user.setSystemRole(systemRole);
        user.setStatus(status);
        wbUserMapper.insert(user);
        return user;
    }

    private WbProjectGroup ensureGroup(String name, String description, Long createdBy) {
        WbProjectGroup existing = wbProjectGroupMapper.selectOne(new LambdaQueryWrapper<WbProjectGroup>()
                .eq(WbProjectGroup::getName, name)
                .last("LIMIT 1"));
        if (existing != null) {
            return existing;
        }

        WbProjectGroup group = new WbProjectGroup();
        group.setName(name);
        group.setDescription(description);
        group.setCreatedBy(createdBy);
        group.setUpdatedBy(createdBy);
        wbProjectGroupMapper.insert(group);
        return group;
    }

    private void ensureMembership(Long groupId, Long userId, String role, Long operatorId) {
        WbProjectGroupMember existing = wbProjectGroupMemberMapper.selectOne(new LambdaQueryWrapper<WbProjectGroupMember>()
                .eq(WbProjectGroupMember::getGroupId, groupId)
                .eq(WbProjectGroupMember::getUserId, userId)
                .last("LIMIT 1"));
        if (existing != null) {
            return;
        }

        WbProjectGroupMember membership = new WbProjectGroupMember();
        membership.setGroupId(groupId);
        membership.setUserId(userId);
        membership.setRole(role);
        membership.setCreatedBy(operatorId);
        membership.setUpdatedBy(operatorId);
        wbProjectGroupMemberMapper.insert(membership);
    }
}
