package com.wbdata.auth.config;

import com.wbdata.auth.context.GroupAuthContextResolver;
import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.method.support.HandlerMethodArgumentResolver;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.util.List;

/**
 * auth 域的 MVC 装配：注册组权限上下文参数解析器。
 */
@Configuration
@RequiredArgsConstructor
public class AuthWebMvcConfig implements WebMvcConfigurer {

    private final GroupAuthContextResolver groupAuthContextResolver;

    @Override
    public void addArgumentResolvers(List<HandlerMethodArgumentResolver> resolvers) {
        resolvers.add(groupAuthContextResolver);
    }
}
