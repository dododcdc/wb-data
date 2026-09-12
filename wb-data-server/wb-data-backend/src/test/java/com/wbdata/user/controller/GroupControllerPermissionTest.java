package com.wbdata.user.controller;

import com.wbdata.auth.context.AuthContext;
import com.wbdata.auth.service.AuthSession;
import com.wbdata.common.dto.PageQuery;
import com.wbdata.group.dto.CreateGroupRequest;
import com.wbdata.group.service.GroupService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;

class GroupControllerPermissionTest {

    private final GroupService groupService = Mockito.mock(GroupService.class);
    private final GroupController controller = new GroupController(groupService);

    @AfterEach
    void clearContext() {
        AuthContext.clear();
    }

    @Test
    void createDelegatesWithOperatorId() {
        AuthContext.set(new AuthSession(7L, "admin", "管理员", "SYSTEM_ADMIN", null));
        CreateGroupRequest req = new CreateGroupRequest();
        req.setName("alpha");

        controller.create(req);

        verify(groupService).createGroup(req, 7L);
    }

    @Test
    void listDelegatesToPagedListing() {
        AuthContext.set(new AuthSession(7L, "admin", "管理员", "SYSTEM_ADMIN", null));

        controller.list(new PageQuery());

        verify(groupService).listGroups(any(PageQuery.class));
    }

    @Test
    void nonAdminIsForbidden() {
        AuthContext.set(new AuthSession(8L, "bob", "Bob", "USER", null));

        assertThatThrownBy(() -> controller.list(new PageQuery()))
                .isInstanceOfSatisfying(ResponseStatusException.class,
                        e -> assertThat(e.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN));
    }
}
