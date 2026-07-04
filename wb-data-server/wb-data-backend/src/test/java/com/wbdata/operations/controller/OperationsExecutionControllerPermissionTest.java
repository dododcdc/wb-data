package com.wbdata.operations.controller;

import com.wbdata.auth.context.RequireGroupAuth;
import com.wbdata.auth.dto.AuthContextResponse;
import com.wbdata.auth.enums.Permission;
import org.junit.jupiter.api.Test;

import java.lang.annotation.Annotation;
import java.lang.reflect.Method;
import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;

class OperationsExecutionControllerPermissionTest {

    @Test
    void readEndpointsRequireOfflineReadAndRerunRequiresOfflineWrite() throws Exception {
        Method list = OperationsExecutionController.class.getMethod(
                "listExecutions",
                AuthContextResponse.class,
                String.class,
                String.class,
                String.class,
                Instant.class,
                Instant.class,
                Integer.class,
                Integer.class
        );
        Method detail = OperationsExecutionController.class.getMethod("getExecution", AuthContextResponse.class, String.class);
        Method logs = OperationsExecutionController.class.getMethod("getLogs", AuthContextResponse.class, String.class, String.class);
        Method rerun = OperationsExecutionController.class.getMethod("rerun", AuthContextResponse.class, String.class);

        assertThat(auth(list).value()).isEqualTo(Permission.OFFLINE_READ);
        assertThat(auth(detail).value()).isEqualTo(Permission.OFFLINE_READ);
        assertThat(auth(logs).value()).isEqualTo(Permission.OFFLINE_READ);
        assertThat(auth(rerun).value()).isEqualTo(Permission.OFFLINE_WRITE);
    }

    private RequireGroupAuth auth(Method method) {
        for (Annotation annotation : method.getParameters()[0].getAnnotations()) {
            if (annotation instanceof RequireGroupAuth requireGroupAuth) {
                return requireGroupAuth;
            }
        }
        throw new AssertionError("Missing RequireGroupAuth on first parameter of " + method.getName());
    }
}
