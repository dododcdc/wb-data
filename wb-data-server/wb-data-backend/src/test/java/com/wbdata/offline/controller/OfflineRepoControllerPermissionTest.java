package com.wbdata.offline.controller;

import com.wbdata.auth.context.RequireGroupAuth;
import com.wbdata.auth.dto.AuthContextResponse;
import com.wbdata.auth.enums.Permission;
import com.wbdata.offline.dto.CommitCurrentFlowRequest;
import com.wbdata.offline.dto.CommitRequest;
import com.wbdata.offline.dto.PushRequest;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Method;

import static org.assertj.core.api.Assertions.assertThat;

class OfflineRepoControllerPermissionTest {

    @Test
    void flowCommit_keepsOfflineWritePermission() throws Exception {
        Method method = OfflineRepoController.class.getMethod(
                "commitCurrentFlow",
                AuthContextResponse.class,
                CommitCurrentFlowRequest.class
        );

        RequireGroupAuth auth = (RequireGroupAuth) method.getParameters()[0].getAnnotations()[0];
        assertThat(auth.value()).isEqualTo(Permission.OFFLINE_WRITE);
    }

    @Test
    void repoCommit_andPush_requireGroupSettingsPermission() throws Exception {
        Method repoCommit = OfflineRepoController.class.getMethod(
                "commitRepo",
                AuthContextResponse.class,
                CommitRequest.class
        );
        Method push = OfflineRepoController.class.getMethod(
                "push",
                AuthContextResponse.class,
                PushRequest.class
        );

        RequireGroupAuth repoCommitAuth = (RequireGroupAuth) repoCommit.getParameters()[0].getAnnotations()[0];
        RequireGroupAuth pushAuth = (RequireGroupAuth) push.getParameters()[0].getAnnotations()[0];

        assertThat(repoCommitAuth.value()).isEqualTo(Permission.GROUP_SETTINGS);
        assertThat(pushAuth.value()).isEqualTo(Permission.GROUP_SETTINGS);
    }
}
