package com.wbdata.offline.config;

import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * 为离线开发相关 HTTP 接口装配分支 worktree 上下文拦截器。
 */
@Configuration
@RequiredArgsConstructor
public class OfflineWebMvcConfig implements WebMvcConfigurer {

    private final OfflineBranchContextInterceptor branchContextInterceptor;

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(branchContextInterceptor)
                .addPathPatterns("/api/v1/offline/**", "/api/v1/groups/*/offline/**")
                .excludePathPatterns("/api/v1/internal/**");
    }
}
