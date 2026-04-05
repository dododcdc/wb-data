package com.wbdata.user.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.wbdata.auth.enums.GroupRole;
import com.wbdata.auth.enums.SystemRole;
import com.wbdata.group.entity.WbProjectGroup;
import com.wbdata.group.entity.WbProjectGroupMember;
import com.wbdata.group.mapper.WbProjectGroupMapper;
import com.wbdata.group.mapper.WbProjectGroupMemberMapper;
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

import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
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
    private final WbProjectGroupMapper groupMapper;
    private final WbProjectGroupMemberMapper groupMemberMapper;
    private final PasswordEncoder passwordEncoder;

    public IPage<UserResponse> listUsers(int page, int size, String keyword) {
        Page<WbUser> pageParam = new Page<>(page, size);
        LambdaQueryWrapper<WbUser> wrapper = new LambdaQueryWrapper<>();

        if (keyword != null && !keyword.isBlank()) {
            String kw = "%" + keyword.trim() + "%";
            wrapper.and(w -> w
                    .like(WbUser::getUsername, kw)
                    .or()
                    .like(WbUser::getDisplayName, kw));
        }

        wrapper.orderByDesc(WbUser::getCreatedAt);
        IPage<WbUser> result = userMapper.selectPage(pageParam, wrapper);

        return result.convert(UserResponse::from);
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

        if (req.getGroupAssignments() != null && !req.getGroupAssignments().isEmpty()) {
            Set<Long> groupIds = new HashSet<>();
            for (GroupAssignment assignment : req.getGroupAssignments()) {
                if (assignment == null || assignment.getGroupId() == null || !groupIds.add(assignment.getGroupId())) {
                    throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "不可重复指定同一项目组");
                }
                validateGroupAssignment(assignment.getGroupId(), assignment.getGroupRole());
            }
        }

        WbUser user = new WbUser();
        user.setUsername(req.getUsername());
        user.setDisplayName(req.getDisplayName());
        user.setPasswordHash(passwordEncoder.encode(req.getPassword()));
        user.setSystemRole(role);
        user.setStatus("ACTIVE");
        user.setCreatedBy(operatorId);
        user.setUpdatedBy(operatorId);
        userMapper.insert(user);

        if (req.getGroupAssignments() != null && !req.getGroupAssignments().isEmpty()) {
            for (GroupAssignment assignment : req.getGroupAssignments()) {
                WbProjectGroupMember member = new WbProjectGroupMember();
                member.setGroupId(assignment.getGroupId());
                member.setUserId(user.getId());
                member.setRole(assignment.getGroupRole());
                member.setCreatedBy(operatorId);
                member.setUpdatedBy(operatorId);
                groupMemberMapper.insert(member);
            }
        }

        return UserResponse.from(userMapper.selectById(user.getId()));
    }

    @Transactional
    public UserResponse updateUser(Long userId, UpdateUserRequest req, Long operatorId) {
        WbUser existing = userMapper.selectById(userId);
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

        if (req.getGroupAssignments() != null) {
            Map<Long, GroupAssignment> submittedMap = new HashMap<>();
            for (GroupAssignment assignment : req.getGroupAssignments()) {
                if (assignment == null || assignment.getGroupId() == null || submittedMap.containsKey(assignment.getGroupId())) {
                    throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "不可重复指定同一项目组");
                }
                validateGroupAssignment(assignment.getGroupId(), assignment.getGroupRole());
                submittedMap.put(assignment.getGroupId(), assignment);
            }

            List<WbProjectGroupMember> existingMembers = groupMemberMapper.selectList(
                    new LambdaQueryWrapper<WbProjectGroupMember>()
                            .eq(WbProjectGroupMember::getUserId, userId));

            Map<Long, WbProjectGroupMember> existingMap = new HashMap<>();
            for (WbProjectGroupMember member : existingMembers) {
                existingMap.put(member.getGroupId(), member);
            }

            for (WbProjectGroupMember member : existingMembers) {
                if (!submittedMap.containsKey(member.getGroupId())) {
                    groupMemberMapper.deleteById(member.getId());
                }
            }

            for (Map.Entry<Long, GroupAssignment> entry : submittedMap.entrySet()) {
                Long groupId = entry.getKey();
                GroupAssignment assignment = entry.getValue();
                WbProjectGroupMember existingMember = existingMap.get(groupId);

                if (existingMember == null) {
                    WbProjectGroupMember newMember = new WbProjectGroupMember();
                    newMember.setGroupId(groupId);
                    newMember.setUserId(userId);
                    newMember.setRole(assignment.getGroupRole());
                    newMember.setCreatedBy(operatorId);
                    newMember.setUpdatedBy(operatorId);
                    groupMemberMapper.insert(newMember);
                } else if (!assignment.getGroupRole().equals(existingMember.getRole())) {
                    WbProjectGroupMember roleUpdate = new WbProjectGroupMember();
                    roleUpdate.setId(existingMember.getId());
                    roleUpdate.setRole(assignment.getGroupRole());
                    roleUpdate.setUpdatedBy(operatorId);
                    groupMemberMapper.updateById(roleUpdate);
                }
            }
        }

        return UserResponse.from(userMapper.selectById(userId));
    }

    public List<UserGroupResponse> getUserGroups(Long userId) {
        WbUser user = userMapper.selectById(userId);
        if (user == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "用户不存在");
        }

        List<WbProjectGroupMember> members = groupMemberMapper.selectList(
                new LambdaQueryWrapper<WbProjectGroupMember>()
                        .eq(WbProjectGroupMember::getUserId, userId));

        if (members.isEmpty()) {
            return List.of();
        }

        List<Long> groupIds = members.stream().map(WbProjectGroupMember::getGroupId).toList();
        List<WbProjectGroup> groups = groupMapper.selectBatchIds(groupIds);
        Map<Long, String> groupNameMap = groups.stream()
                .collect(Collectors.toMap(WbProjectGroup::getId, WbProjectGroup::getName));

        return members.stream().map(m -> {
            UserGroupResponse resp = new UserGroupResponse();
            resp.setGroupId(m.getGroupId());
            resp.setGroupName(groupNameMap.getOrDefault(m.getGroupId(), ""));
            resp.setGroupRole(m.getRole());
            return resp;
        }).toList();
    }

    public void changeStatus(Long userId, UpdateUserStatusRequest req, Long operatorId) {
        WbUser existing = userMapper.selectById(userId);
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
    }

    public void resetPassword(Long userId, ResetPasswordRequest req, Long operatorId) {
        WbUser existing = userMapper.selectById(userId);
        if (existing == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "用户不存在");
        }

        WbUser update = new WbUser();
        update.setId(userId);
        update.setPasswordHash(passwordEncoder.encode(req.getNewPassword()));
        update.setUpdatedBy(operatorId);
        userMapper.updateById(update);
    }

    private void validateGroupAssignment(Long groupId, String groupRole) {
        if (groupRole == null || groupRole.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "请选择项目组角色");
        }
        if (!VALID_GROUP_ROLES.contains(groupRole)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "无效的项目组角色");
        }
        WbProjectGroup group = groupMapper.selectById(groupId);
        if (group == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "指定的项目组不存在");
        }
    }
}
