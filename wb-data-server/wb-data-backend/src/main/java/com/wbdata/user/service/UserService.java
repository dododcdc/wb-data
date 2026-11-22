package com.wbdata.user.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.wbdata.auth.enums.GroupRole;
import com.wbdata.auth.enums.SystemRole;
import com.wbdata.common.dto.PageQuery;
import com.wbdata.common.dto.PageResult;
import com.wbdata.user.dto.CreateUserRequest;
import com.wbdata.user.dto.GroupAssignment;
import com.wbdata.user.dto.ResetPasswordRequest;
import com.wbdata.user.dto.UpdateUserRequest;
import com.wbdata.user.dto.UpdateUserStatusRequest;
import com.wbdata.user.dto.UserGroupResponse;
import com.wbdata.user.dto.UserResponse;
import com.wbdata.user.entity.WbUser;
import com.wbdata.user.mapper.WbUserMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class UserService {

    private static final Set<String> VALID_SYSTEM_ROLES =
            java.util.Arrays.stream(SystemRole.values()).map(Enum::name).collect(Collectors.toUnmodifiableSet());
    private static final Set<String> VALID_GROUP_ROLES =
            java.util.Arrays.stream(GroupRole.values()).map(Enum::name).collect(Collectors.toUnmodifiableSet());

    private final WbUserMapper userMapper;
    private final UserGroupMembershipPort groupMembershipPort;
    private final PasswordEncoder passwordEncoder;

    public PageResult<UserResponse> listUsers(PageQuery query) {
        Page<WbUser> pageParam = query.toMyBatisPage();
        LambdaQueryWrapper<WbUser> wrapper = new LambdaQueryWrapper<>();

        String keyword = query.getKeyword();
        if (keyword != null && !keyword.isBlank()) {
            String kw = "%" + keyword.trim() + "%";
            wrapper.and(w -> w
                    .like(WbUser::getUsername, kw)
                    .or()
                    .like(WbUser::getDisplayName, kw));
        }

        wrapper.orderByDesc(WbUser::getCreatedAt);
        return PageResult.of(userMapper.selectPage(pageParam, wrapper))
                .convert(UserResponse::from);
    }

    @Transactional
    public UserResponse createUser(CreateUserRequest req, Long operatorId) {
        boolean exists = userMapper.exists(new LambdaQueryWrapper<WbUser>()
                .eq(WbUser::getUsername, req.getUsername()));
        if (exists) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "用户名已存在");
        }

        String role = req.getSystemRole() != null ? req.getSystemRole() : "USER";
        if (!VALID_SYSTEM_ROLES.contains(role)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "无效的系统角色");
        }

        List<UserGroupMembershipPort.MembershipSpec> groupSpecs =
                (req.getGroupAssignments() == null || req.getGroupAssignments().isEmpty())
                        ? List.of()
                        : parseAndValidateGroupAssignments(req.getGroupAssignments());

        WbUser user = new WbUser();
        user.setUsername(req.getUsername());
        user.setDisplayName(req.getDisplayName());
        user.setPasswordHash(passwordEncoder.encode(req.getPassword()));
        user.setSystemRole(role);
        user.setStatus("ACTIVE");
        user.setCreatedBy(operatorId);
        user.setUpdatedBy(operatorId);
        userMapper.insert(user);

        if (!groupSpecs.isEmpty()) {
            groupMembershipPort.assignMemberships(user.getId(), groupSpecs, operatorId);
        }

        return UserResponse.from(userMapper.selectById(user.getId()));
    }

    @Transactional
    public UserResponse updateUser(Long userId, UpdateUserRequest req, Long operatorId) {
        WbUser existing = userMapper.selectForUpdate(userId);
        if (existing == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "用户不存在");
        }

        if (req.getSystemRole() != null && userId.equals(operatorId)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "不可修改自己的系统角色");
        }

        if (req.getSystemRole() != null && !VALID_SYSTEM_ROLES.contains(req.getSystemRole())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "无效的系统角色");
        }

        WbUser update = new WbUser();
        update.setId(userId);
        update.setDisplayName(req.getDisplayName());
        if (req.getSystemRole() != null) {
            update.setSystemRole(req.getSystemRole());
        }
        update.setUpdatedBy(operatorId);
        userMapper.updateById(update);
        if (req.getSystemRole() != null && !req.getSystemRole().equals(existing.getSystemRole())) {
            userMapper.incrementAuthVersion(userId);
        }

        if (req.getGroupAssignments() != null) {
            List<UserGroupMembershipPort.MembershipSpec> groupSpecs =
                    parseAndValidateGroupAssignments(req.getGroupAssignments());
            groupMembershipPort.syncMemberships(userId, groupSpecs, operatorId);
        }

        return UserResponse.from(userMapper.selectById(userId));
    }

    public List<UserGroupResponse> getUserGroups(Long userId) {
        WbUser user = userMapper.selectById(userId);
        if (user == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "用户不存在");
        }

        return groupMembershipPort.listUserGroups(userId).stream()
                .map(assigned -> {
                    UserGroupResponse resp = new UserGroupResponse();
                    resp.setGroupId(assigned.groupId());
                    resp.setGroupName(assigned.groupName());
                    resp.setGroupRole(assigned.groupRole());
                    return resp;
                })
                .toList();
    }

    @Transactional
    public void changeStatus(Long userId, UpdateUserStatusRequest req, Long operatorId) {
        WbUser existing = userMapper.selectForUpdate(userId);
        if (existing == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "用户不存在");
        }

        if ("DISABLED".equals(req.getStatus()) && userId.equals(operatorId)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "不可禁用自己");
        }

        WbUser update = new WbUser();
        update.setId(userId);
        update.setStatus(req.getStatus());
        update.setUpdatedBy(operatorId);
        userMapper.updateById(update);
        if (!req.getStatus().equals(existing.getStatus())) {
            userMapper.incrementAuthVersion(userId);
        }
    }

    @Transactional
    public void resetPassword(Long userId, ResetPasswordRequest req, Long operatorId) {
        WbUser existing = userMapper.selectForUpdate(userId);
        if (existing == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "用户不存在");
        }

        WbUser update = new WbUser();
        update.setId(userId);
        update.setPasswordHash(passwordEncoder.encode(req.getNewPassword()));
        update.setUpdatedBy(operatorId);
        userMapper.updateById(update);
        userMapper.incrementAuthVersion(userId);
    }

    private List<UserGroupMembershipPort.MembershipSpec> parseAndValidateGroupAssignments(
            List<GroupAssignment> assignments) {
        Set<Long> groupIds = new LinkedHashSet<>();
        List<UserGroupMembershipPort.MembershipSpec> specs = new ArrayList<>(assignments.size());
        for (GroupAssignment assignment : assignments) {
            if (assignment == null || assignment.getGroupId() == null || !groupIds.add(assignment.getGroupId())) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "不可重复指定同一项目组");
            }
            String groupRole = assignment.getGroupRole();
            if (groupRole == null || groupRole.isBlank()) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "请选择项目组角色");
            }
            if (!VALID_GROUP_ROLES.contains(groupRole)) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "无效的项目组角色");
            }
            specs.add(new UserGroupMembershipPort.MembershipSpec(assignment.getGroupId(), groupRole));
        }
        if (!groupIds.isEmpty()) {
            groupMembershipPort.assertGroupsExist(groupIds);
        }
        return specs;
    }
}
