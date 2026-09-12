package com.wbdata.user.controller;

import com.wbdata.auth.context.AuthContext;
import com.wbdata.auth.service.AuthSession;
import com.wbdata.user.dto.CreateUserRequest;
import com.wbdata.user.dto.ResetPasswordRequest;
import com.wbdata.user.dto.UpdateUserStatusRequest;
import com.wbdata.user.service.UserService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.verify;

class UserControllerPermissionTest {

    private final UserService userService = Mockito.mock(UserService.class);
    private final UserController controller = new UserController(userService);

    @AfterEach
    void clearContext() {
        AuthContext.clear();
    }

    @Test
    void createDelegatesWithOperatorId() {
        AuthContext.set(adminSession());
        CreateUserRequest req = new CreateUserRequest();
        req.setUsername("alice");

        controller.create(req);

        verify(userService).createUser(req, 7L);
    }

    @Test
    void changeStatusDelegatesWithOperatorId() {
        AuthContext.set(adminSession());
        UpdateUserStatusRequest req = new UpdateUserStatusRequest();
        req.setStatus("DISABLED");

        controller.changeStatus(3L, req);

        verify(userService).changeStatus(3L, req, 7L);
    }

    @Test
    void resetPasswordDelegatesWithOperatorId() {
        AuthContext.set(adminSession());
        ResetPasswordRequest req = new ResetPasswordRequest();
        req.setNewPassword("new-pass");

        controller.resetPassword(3L, req);

        verify(userService).resetPassword(3L, req, 7L);
    }

    @Test
    void nonAdminIsForbidden() {
        AuthContext.set(new AuthSession(8L, "bob", "Bob", "USER", null));

        assertThatThrownBy(() -> controller.list(1, 10, null))
                .isInstanceOfSatisfying(ResponseStatusException.class,
                        e -> org.assertj.core.api.Assertions.assertThat(e.getStatusCode())
                                .isEqualTo(HttpStatus.FORBIDDEN));
    }

    @Test
    void unauthenticatedIsUnauthorized() {
        assertThatThrownBy(() -> controller.list(1, 10, null))
                .isInstanceOfSatisfying(ResponseStatusException.class,
                        e -> org.assertj.core.api.Assertions.assertThat(e.getStatusCode())
                                .isEqualTo(HttpStatus.UNAUTHORIZED));
    }

    private static AuthSession adminSession() {
        return new AuthSession(7L, "admin", "管理员", "SYSTEM_ADMIN", null);
    }
}
