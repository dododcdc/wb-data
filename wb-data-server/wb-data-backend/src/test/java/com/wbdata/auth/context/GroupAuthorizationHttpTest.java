package com.wbdata.auth.context;

import com.wbdata.auth.controller.AuthController;
import com.wbdata.auth.service.AuthContextService;
import com.wbdata.auth.service.AuthService;
import com.wbdata.auth.service.GroupAuthorizationService;
import com.wbdata.auth.service.AuthSession;
import com.wbdata.auth.service.AuthTokenService;
import com.wbdata.auth.service.PermissionService;
import com.wbdata.group.controller.GroupSettingsController;
import com.wbdata.group.entity.WbProjectGroup;
import com.wbdata.group.entity.WbProjectGroupMember;
import com.wbdata.group.mapper.WbProjectGroupMapper;
import com.wbdata.group.mapper.WbProjectGroupMemberMapper;
import com.wbdata.group.mapper.WbUserGroupPreferenceMapper;
import com.wbdata.group.service.GroupSettingsService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.time.Instant;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class GroupAuthorizationHttpTest {
    private final WbProjectGroupMapper groups = mock(WbProjectGroupMapper.class);
    private final WbProjectGroupMemberMapper members = mock(WbProjectGroupMemberMapper.class);
    private final WbUserGroupPreferenceMapper preferences = mock(WbUserGroupPreferenceMapper.class);
    private final GroupSettingsService settings = mock(GroupSettingsService.class);
    private final AuthTokenService tokens = mock(AuthTokenService.class);
    private final WbProjectGroup group = new WbProjectGroup();
    private final WbProjectGroupMember member = new WbProjectGroupMember();
    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        group.setId(1L);
        group.setName("Group A");
        member.setGroupId(1L);
        member.setUserId(10L);
        member.setRole("GROUP_ADMIN");
        when(groups.selectById(1L)).thenReturn(group);
        when(groups.selectBatchIds(any())).thenAnswer(invocation -> List.of(group));
        when(groups.selectList(any())).thenAnswer(invocation -> List.of(group));
        when(members.selectList(any())).thenAnswer(invocation -> List.of(member));
        when(members.selectOne(any())).thenReturn(member);
        when(tokens.resolveToken(anyString())).thenReturn(session("USER"));
        AuthContextService contexts = new AuthContextService(groups, members, preferences, new PermissionService());
        mvc = MockMvcBuilders.standaloneSetup(new GroupSettingsController(settings),
                        new AuthController(mock(AuthService.class), contexts, tokens))
                .setCustomArgumentResolvers(new GroupAuthContextResolver(
                        new GroupAuthorizationService(groups, members, new PermissionService())))
                .addFilters(new AuthFilter(tokens))
                .build();
    }

    @AfterEach
    void clearContext() {
        assertThat(AuthContext.current()).isNull();
        AuthContext.clear();
    }

    @Test
    void disabledGroupRejectsExistingMember() throws Exception {
        group.setStatus("disabled");
        mvc.perform(get("/api/v1/groups/1/settings").header("Authorization", "Bearer token"))
                .andExpect(status().isForbidden());
        verifyNoInteractions(settings);
    }

    @Test
    void disabledGroupAlsoRejectsSystemAdministratorOnBusinessEndpoints() throws Exception {
        group.setStatus("disabled");
        when(tokens.resolveToken(anyString())).thenReturn(session("SYSTEM_ADMIN"));
        mvc.perform(get("/api/v1/groups/1/settings").header("Authorization", "Bearer token"))
                .andExpect(status().isForbidden());
        verifyNoInteractions(settings);
    }

    @Test
    void conflictingPathAndQueryGroupsAreRejectedBeforeBusinessCalls() throws Exception {
        mvc.perform(get("/api/v1/groups/2/settings").param("groupId", "1")
                        .header("Authorization", "Bearer token"))
                .andExpect(status().isBadRequest());
        verifyNoInteractions(settings);
    }

    @Test
    void repeatedGroupParametersAreRejected() throws Exception {
        mvc.perform(get("/api/v1/groups/1/settings").param("groupId", "1", "2")
                        .header("Authorization", "Bearer token"))
                .andExpect(status().isBadRequest());
        verifyNoInteractions(settings);
    }

    @Test
    void authorizationDoesNotWriteOrReadUserPreferences() throws Exception {
        mvc.perform(get("/api/v1/groups/1/settings").param("groupId", "1")
                        .header("Authorization", "Bearer token"))
                .andExpect(status().isOk());
        verify(settings).getGroupInfo(1L);
        verifyNoInteractions(preferences);
    }

    @Test
    void foreignGroupIsForbidden() throws Exception {
        mvc.perform(get("/api/v1/groups/2/settings").header("Authorization", "Bearer token"))
                .andExpect(status().isForbidden());
        verifyNoInteractions(settings);
    }

    @Test
    void developerCanReadButCannotManageMembers() throws Exception {
        member.setRole("DEVELOPER");
        mvc.perform(get("/api/v1/groups/1/settings").header("Authorization", "Bearer token"))
                .andExpect(status().isOk());
        mvc.perform(get("/api/v1/groups/1/settings/available-users").header("Authorization", "Bearer token"))
                .andExpect(status().isForbidden());
        verify(settings).getGroupInfo(1L);
        verifyNoMoreInteractions(settings);
    }

    @Test
    void membershipRevocationIsEffectiveOnNextRequest() throws Exception {
        mvc.perform(get("/api/v1/groups/1/settings").header("Authorization", "Bearer token"))
                .andExpect(status().isOk());
        when(members.selectList(any())).thenReturn(List.of());
        when(members.selectOne(any())).thenReturn(null);
        mvc.perform(get("/api/v1/groups/1/settings").header("Authorization", "Bearer token"))
                .andExpect(status().isForbidden());
        verify(settings, times(1)).getGroupInfo(1L);
    }

    @Test
    void queryOnlyRoutesRemainSupportedWithoutChangingTarget() throws Exception {
        mvc.perform(get("/api/v1/group-settings").param("groupId", "1")
                        .header("Authorization", "Bearer token"))
                .andExpect(status().isOk());
        verify(settings).getGroupInfo(1L);
    }

    @Test
    void anonymousRequestIsUnauthorized() throws Exception {
        mvc.perform(get("/api/v1/groups/1/settings")).andExpect(status().isUnauthorized());
        verifyNoInteractions(settings);
    }

    @Test
    void malformedOrMissingGroupIsRejected() throws Exception {
        for (String invalid : List.of("abc", "", "0", "-1")) {
            mvc.perform(get("/api/v1/groups/1/settings").param("groupId", invalid)
                            .header("Authorization", "Bearer token"))
                    .andExpect(status().isBadRequest());
        }
        mvc.perform(get("/api/v1/group-settings").header("Authorization", "Bearer token"))
                .andExpect(status().isBadRequest());
        verifyNoInteractions(settings);
    }

    @Test
    void contextReadAndExplicitSelectionHaveSeparateSideEffects() throws Exception {
        mvc.perform(get("/api/v1/auth/context").param("groupId", "1")
                        .header("Authorization", "Bearer token"))
                .andExpect(status().isOk());
        verifyNoInteractions(preferences);
        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post("/api/v1/auth/context")
                        .param("groupId", "1").header("Authorization", "Bearer token"))
                .andExpect(status().isOk());
        verify(preferences).recordSelection(eq(10L), eq(1L), any());
        verifyNoMoreInteractions(preferences);
    }

    private AuthSession session(String role) {
        return new AuthSession(10L, "review-user", "Review user", role, Instant.now().plusSeconds(600));
    }
}
