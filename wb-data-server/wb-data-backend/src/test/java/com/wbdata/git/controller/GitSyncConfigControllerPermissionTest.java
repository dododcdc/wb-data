package com.wbdata.git.controller;

import com.wbdata.auth.context.RequireGroupAuth;
import com.wbdata.auth.dto.AuthContextResponse;
import com.wbdata.auth.enums.Permission;
import com.wbdata.git.dto.CreateGitSyncConfigRequest;
import com.wbdata.git.dto.UpdateGitSyncConfigStatusRequest;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Method;

import static org.assertj.core.api.Assertions.assertThat;

class GitSyncConfigControllerPermissionTest {

    @Test
    void listRequiresOfflineReadAndMutationsRequireGroupSettings() throws Exception {
        Method list = GitSyncConfigController.class.getMethod("list", AuthContextResponse.class);
        Method create = GitSyncConfigController.class.getMethod("create", AuthContextResponse.class, CreateGitSyncConfigRequest.class);
        Method createAll = GitSyncConfigController.class.getMethod("createAllKnownBranches", AuthContextResponse.class);
        Method updateStatus = GitSyncConfigController.class.getMethod("updateStatus", AuthContextResponse.class, Long.class, UpdateGitSyncConfigStatusRequest.class);
        Method trigger = GitSyncConfigController.class.getMethod("trigger", AuthContextResponse.class, Long.class);
        Method delete = GitSyncConfigController.class.getMethod("delete", AuthContextResponse.class, Long.class);

        assertThat(auth(list).value()).isEqualTo(Permission.OFFLINE_READ);
        assertThat(auth(create).value()).isEqualTo(Permission.GROUP_SETTINGS);
        assertThat(auth(createAll).value()).isEqualTo(Permission.GROUP_SETTINGS);
        assertThat(auth(updateStatus).value()).isEqualTo(Permission.GROUP_SETTINGS);
        assertThat(auth(trigger).value()).isEqualTo(Permission.GROUP_SETTINGS);
        assertThat(auth(delete).value()).isEqualTo(Permission.GROUP_SETTINGS);
    }

    private RequireGroupAuth auth(Method method) {
        return (RequireGroupAuth) method.getParameters()[0].getAnnotations()[0];
    }
}
