package com.wbdata.offline.controller;

import com.wbdata.auth.context.RequireGroupAuth;
import com.wbdata.auth.dto.AuthContextResponse;
import com.wbdata.auth.enums.Permission;
import com.wbdata.offline.dto.CommitCurrentFlowRequest;
import com.wbdata.offline.dto.CommitRequest;
import com.wbdata.offline.dto.CreateBranchRequest;
import com.wbdata.offline.dto.DeleteBranchRequest;
import com.wbdata.offline.dto.MergeBranchRequest;
import com.wbdata.offline.dto.PushRequest;
import com.wbdata.offline.dto.SwitchBranchRequest;
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

    @Test
    void branchList_requiresOfflineRead_andMutationsRequireGroupSettings() throws Exception {
        Method list = OfflineRepoController.class.getMethod(
                "listBranches",
                AuthContextResponse.class
        );
        Method create = OfflineRepoController.class.getMethod(
                "createBranch",
                AuthContextResponse.class,
                CreateBranchRequest.class
        );
        Method switchBranch = OfflineRepoController.class.getMethod(
                "switchBranch",
                AuthContextResponse.class,
                SwitchBranchRequest.class
        );
        Method merge = OfflineRepoController.class.getMethod(
                "mergeBranch",
                AuthContextResponse.class,
                MergeBranchRequest.class
        );
        Method delete = OfflineRepoController.class.getMethod(
                "deleteBranch",
                AuthContextResponse.class,
                DeleteBranchRequest.class
        );

        assertThat(((RequireGroupAuth) list.getParameters()[0].getAnnotations()[0]).value()).isEqualTo(Permission.OFFLINE_READ);
        assertThat(((RequireGroupAuth) create.getParameters()[0].getAnnotations()[0]).value()).isEqualTo(Permission.GROUP_SETTINGS);
        assertThat(((RequireGroupAuth) switchBranch.getParameters()[0].getAnnotations()[0]).value()).isEqualTo(Permission.GROUP_SETTINGS);
        assertThat(((RequireGroupAuth) merge.getParameters()[0].getAnnotations()[0]).value()).isEqualTo(Permission.GROUP_SETTINGS);
        assertThat(((RequireGroupAuth) delete.getParameters()[0].getAnnotations()[0]).value()).isEqualTo(Permission.GROUP_SETTINGS);
    }
}
