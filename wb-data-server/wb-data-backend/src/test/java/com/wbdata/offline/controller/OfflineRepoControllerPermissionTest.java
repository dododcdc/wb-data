package com.wbdata.offline.controller;

import com.wbdata.auth.context.RequireGroupAuth;
import com.wbdata.auth.context.GroupAuthContext;
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
                GroupAuthContext.class,
                CommitCurrentFlowRequest.class
        );

        RequireGroupAuth auth = (RequireGroupAuth) method.getParameters()[0].getAnnotations()[0];
        assertThat(auth.value()).isEqualTo(Permission.OFFLINE_WRITE);
    }

    @Test
    void repoCommit_andPush_requireGroupSettingsPermission() throws Exception {
        Method repoCommit = OfflineRepoController.class.getMethod(
                "commitRepo",
                GroupAuthContext.class,
                CommitRequest.class
        );
        Method push = OfflineRepoController.class.getMethod(
                "push",
                GroupAuthContext.class,
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
                GroupAuthContext.class
        );
        Method create = OfflineRepoController.class.getMethod(
                "createBranch",
                GroupAuthContext.class,
                CreateBranchRequest.class
        );
        Method switchBranch = OfflineRepoController.class.getMethod(
                "switchBranch",
                GroupAuthContext.class,
                SwitchBranchRequest.class
        );
        Method merge = OfflineRepoController.class.getMethod(
                "mergeBranch",
                GroupAuthContext.class,
                MergeBranchRequest.class
        );
        Method delete = OfflineRepoController.class.getMethod(
                "deleteBranch",
                GroupAuthContext.class,
                DeleteBranchRequest.class
        );

        assertThat(((RequireGroupAuth) list.getParameters()[0].getAnnotations()[0]).value()).isEqualTo(Permission.OFFLINE_READ);
        assertThat(((RequireGroupAuth) create.getParameters()[0].getAnnotations()[0]).value()).isEqualTo(Permission.GROUP_SETTINGS);
        assertThat(((RequireGroupAuth) switchBranch.getParameters()[0].getAnnotations()[0]).value()).isEqualTo(Permission.GROUP_SETTINGS);
        assertThat(((RequireGroupAuth) merge.getParameters()[0].getAnnotations()[0]).value()).isEqualTo(Permission.GROUP_SETTINGS);
        assertThat(((RequireGroupAuth) delete.getParameters()[0].getAnnotations()[0]).value()).isEqualTo(Permission.GROUP_SETTINGS);
    }
}
