package com.wbdata.auth.context;

import com.wbdata.auth.enums.Permission;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * 要求项目组权限的注解
 * 用于 Controller 方法参数，自动注入 AuthContextResponse 并校验权限
 */
@Target({ElementType.PARAMETER})
@Retention(RetentionPolicy.RUNTIME)
public @interface RequireGroupAuth {
    /**
     * 所需权限常量
     */
    Permission value();
}
