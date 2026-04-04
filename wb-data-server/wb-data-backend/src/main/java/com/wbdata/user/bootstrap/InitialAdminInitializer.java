package com.wbdata.user.bootstrap;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.wbdata.user.entity.WbUser;
import com.wbdata.user.mapper.WbUserMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.annotation.Order;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;

@Slf4j
@Component
@Order(0)
@RequiredArgsConstructor
public class InitialAdminInitializer implements ApplicationRunner {

    private final WbUserMapper wbUserMapper;
    private final PasswordEncoder passwordEncoder;

    @Value("${INIT_ADMIN_USERNAME:}")
    private String initAdminUsername;

    @Value("${INIT_ADMIN_PASSWORD:}")
    private String initAdminPassword;

    @Override
    public void run(ApplicationArguments args) {
        Long userCount = wbUserMapper.selectCount(Wrappers.emptyWrapper());
        if (userCount != null && userCount > 0) {
            return;
        }

        if (initAdminUsername == null || initAdminUsername.isBlank()
                || initAdminPassword == null || initAdminPassword.isBlank()) {
            log.warn("wb_user 为空，但未提供 INIT_ADMIN_USERNAME / INIT_ADMIN_PASSWORD，跳过初始管理员创建。");
            return;
        }

        WbUser admin = new WbUser();
        admin.setUsername(initAdminUsername.trim());
        admin.setPasswordHash(passwordEncoder.encode(initAdminPassword));
        admin.setDisplayName(initAdminUsername.trim());
        admin.setSystemRole("SYSTEM_ADMIN");
        admin.setStatus("ACTIVE");

        wbUserMapper.insert(admin);
        log.info("已初始化首个 SYSTEM_ADMIN 账号: {}", initAdminUsername);
    }
}
