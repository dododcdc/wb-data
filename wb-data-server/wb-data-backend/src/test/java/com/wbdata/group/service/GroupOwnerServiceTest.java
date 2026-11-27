package com.wbdata.group.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.wbdata.auth.enums.GroupRole;
import com.wbdata.auth.enums.SystemRole;
import com.wbdata.group.dto.AssetOwnerSummaryResponse;
import com.wbdata.group.dto.GroupOwnerInfo;
import com.wbdata.group.dto.GroupOwnerOptionResponse;
import com.wbdata.group.entity.WbProjectGroupMember;
import com.wbdata.group.mapper.WbProjectGroupMemberMapper;
import com.wbdata.user.entity.WbUser;
import com.wbdata.user.mapper.WbUserMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.Mockito.when;

class GroupOwnerServiceTest {

    private WbProjectGroupMemberMapper memberMapper;
    private WbUserMapper userMapper;
    private GroupOwnerService service;

    @BeforeEach
    void setUp() {
        memberMapper = Mockito.mock(WbProjectGroupMemberMapper.class);
        userMapper = Mockito.mock(WbUserMapper.class);
        service = new GroupOwnerService(memberMapper, userMapper);
    }

    @Test
    void listOwnerCandidatesIncludesActiveMembersAndSystemAdmins() {
        WbProjectGroupMember devMember = member(4L, 2L, GroupRole.DEVELOPER.name());
        WbProjectGroupMember adminMember = member(4L, 3L, GroupRole.GROUP_ADMIN.name());
        WbProjectGroupMember disabledMember = member(4L, 4L, GroupRole.DEVELOPER.name());
        when(memberMapper.selectList(any(LambdaQueryWrapper.class)))
                .thenReturn(List.of(devMember, adminMember, disabledMember));

        WbUser dev = user(2L, "xiaoming", "小明", SystemRole.USER.name(), "ACTIVE");
        WbUser ga = user(3L, "xiaohong", "小红", SystemRole.USER.name(), "ACTIVE");
        WbUser disabled = user(4L, "former", "离职人员", SystemRole.USER.name(), "DISABLED");
        when(userMapper.selectBatchIds(anyCollection())).thenReturn(List.of(dev, ga, disabled));

        WbUser sysAdmin = user(1L, "admin", "系统管理员", SystemRole.SYSTEM_ADMIN.name(), "ACTIVE");
        when(userMapper.selectList(any(LambdaQueryWrapper.class))).thenReturn(List.of(sysAdmin));

        List<GroupOwnerOptionResponse> candidates = service.listOwnerCandidates(4L);

        assertThat(candidates).extracting(GroupOwnerOptionResponse::userId)
                .containsExactly(3L, 2L, 1L);
        assertThat(candidates).extracting(GroupOwnerOptionResponse::role)
                .containsExactly("GROUP_ADMIN", "DEVELOPER", "SYSTEM_ADMIN");
    }

    @Test
    void requireAssignableOwnerRejectsNonMemberAndDisabledUsers() {
        WbUser nonMember = user(9L, "outsider", "外组人员", SystemRole.USER.name(), "ACTIVE");
        when(userMapper.selectById(9L)).thenReturn(nonMember);
        when(memberMapper.exists(any(LambdaQueryWrapper.class))).thenReturn(false);

        assertThatThrownBy(() -> service.requireAssignableOwner(4L, 9L))
                .isInstanceOf(ResponseStatusException.class)
                .extracting(ex -> ((ResponseStatusException) ex).getStatusCode())
                .isEqualTo(HttpStatus.BAD_REQUEST);

        WbUser disabled = user(10L, "inactive", "停用账号", SystemRole.USER.name(), "DISABLED");
        when(userMapper.selectById(10L)).thenReturn(disabled);

        assertThatThrownBy(() -> service.requireAssignableOwner(4L, 10L))
                .isInstanceOf(ResponseStatusException.class)
                .extracting(ex -> ((ResponseStatusException) ex).getStatusCode())
                .isEqualTo(HttpStatus.BAD_REQUEST);

        WbUser sysAdmin = user(1L, "admin", "系统管理员", SystemRole.SYSTEM_ADMIN.name(), "ACTIVE");
        when(userMapper.selectById(1L)).thenReturn(sysAdmin);
        GroupOwnerInfo ownerInfo = service.requireAssignableOwner(4L, 1L);
        assertThat(ownerInfo.effectiveName()).isEqualTo("系统管理员");
        assertThat(ownerInfo.status()).isEqualTo("ACTIVE");
    }

    @Test
    void resolveOwnersAndSummarizeMarkDisabledAndLeftGroupUsers() {
        WbUser activeMember = user(2L, "xiaohong", "小红", SystemRole.USER.name(), "ACTIVE");
        WbUser leftUser = user(3L, "xiaoming", "小明", SystemRole.USER.name(), "ACTIVE");
        WbUser disabledUser = user(4L, "old", "已禁用", SystemRole.USER.name(), "DISABLED");
        when(userMapper.selectBatchIds(anyCollection())).thenReturn(List.of(activeMember, leftUser, disabledUser));
        when(memberMapper.selectList(any(LambdaQueryWrapper.class)))
                .thenReturn(List.of(member(4L, 2L, GroupRole.DEVELOPER.name())));

        List<AssetOwnerSummaryResponse> summary = service.summarizeOwners(4L, Map.of(2L, 3L, 3L, 10L, 4L, 1L));

        assertThat(summary).extracting(AssetOwnerSummaryResponse::userId)
                .containsExactly(3L, 2L, 4L);
        assertThat(summary).extracting(AssetOwnerSummaryResponse::status)
                .containsExactly("LEFT_GROUP", "ACTIVE", "DISABLED");
    }

    private static WbProjectGroupMember member(Long groupId, Long userId, String role) {
        WbProjectGroupMember m = new WbProjectGroupMember();
        m.setGroupId(groupId);
        m.setUserId(userId);
        m.setRole(role);
        return m;
    }

    private static WbUser user(Long id, String username, String displayName, String systemRole, String status) {
        WbUser u = new WbUser();
        u.setId(id);
        u.setUsername(username);
        u.setDisplayName(displayName);
        u.setSystemRole(systemRole);
        u.setStatus(status);
        return u;
    }
}
