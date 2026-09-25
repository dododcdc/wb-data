package com.wbdata.parameter.controller;

import com.wbdata.auth.context.RequireGroupAuth;
import com.wbdata.auth.context.GroupAuthContext;
import com.wbdata.auth.enums.Permission;
import com.wbdata.common.dto.PageQuery;
import com.wbdata.parameter.dto.CreateParameterGroupRequest;
import com.wbdata.parameter.dto.ParameterPreviewRequest;
import com.wbdata.parameter.dto.UpdateParameterGroupRequest;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Method;

import static org.assertj.core.api.Assertions.assertThat;

class ParameterGroupControllerPermissionTest {

    @Test
    void readsRequireParameterReadAndMutationsRequireParameterWrite() throws Exception {
        Method list = ParameterGroupController.class.getMethod(
                "list", GroupAuthContext.class, PageQuery.class, String.class);
        Method create = ParameterGroupController.class.getMethod(
                "create", GroupAuthContext.class, CreateParameterGroupRequest.class);
        Method get = ParameterGroupController.class.getMethod(
                "get", GroupAuthContext.class, Long.class);
        Method update = ParameterGroupController.class.getMethod(
                "update", GroupAuthContext.class, Long.class, UpdateParameterGroupRequest.class);
        Method archive = ParameterGroupController.class.getMethod(
                "archive", GroupAuthContext.class, Long.class);
        Method restore = ParameterGroupController.class.getMethod(
                "restore", GroupAuthContext.class, Long.class);
        Method preview = ParameterGroupController.class.getMethod(
                "preview", GroupAuthContext.class, Long.class, ParameterPreviewRequest.class);

        assertThat(auth(list).value()).isEqualTo(Permission.PARAMETER_READ);
        assertThat(auth(get).value()).isEqualTo(Permission.PARAMETER_READ);
        assertThat(auth(preview).value()).isEqualTo(Permission.PARAMETER_READ);
        assertThat(auth(create).value()).isEqualTo(Permission.PARAMETER_WRITE);
        assertThat(auth(update).value()).isEqualTo(Permission.PARAMETER_WRITE);
        assertThat(auth(archive).value()).isEqualTo(Permission.PARAMETER_WRITE);
        assertThat(auth(restore).value()).isEqualTo(Permission.PARAMETER_WRITE);
    }

    private RequireGroupAuth auth(Method method) {
        return method.getParameters()[0].getAnnotation(RequireGroupAuth.class);
    }
}
