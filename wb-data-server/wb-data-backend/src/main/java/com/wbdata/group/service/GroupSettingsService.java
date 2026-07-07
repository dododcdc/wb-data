package com.wbdata.group.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.wbdata.common.dto.PageQuery;
import com.wbdata.common.dto.PageResult;
import com.wbdata.auth.enums.GroupRole;
import com.wbdata.auth.enums.SystemRole;
import com.wbdata.group.dto.*;
import com.wbdata.group.entity.WbProjectGroup;
import com.wbdata.group.entity.WbProjectGroupMember;
import com.wbdata.group.mapper.WbProjectGroupMapper;
import com.wbdata.group.mapper.WbProjectGroupMemberMapper;
import com.wbdata.user.entity.WbUser;
import com.wbdata.user.mapper.WbUserMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class GroupSettingsService {

    private static final String SYSTEM_ADMIN_MEMBER_REASON = "系统管理员账号已拥有全局权限，不可加入项目组";

    private final WbProjectGroupMapper groupMapper;
    private final WbProjectGroupMemberMapper memberMapper;
    private final WbProjectGroupMemberService memberService;
    private final WbUserMapper userMapper;

    public GroupSettingsResponse getGroupInfo(Long groupId) {
        WbProjectGroup group = groupMapper.selectById(groupId);
        if (group == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "项目组不存在");
        }
        return GroupSettingsResponse.from(group);
    }

    @Transactional
    public GroupSettingsResponse updateGroupInfo(Long groupId, UpdateGroupSettingsRequest req, Long operatorId) {
        WbProjectGroup group = groupMapper.selectById(groupId);
        if (group == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "项目组不存在");
        }

        boolean nameConflict = groupMapper.exists(new LambdaQueryWrapper<WbProjectGroup>()
                .eq(WbProjectGroup::getName, req.getName())
                .ne(WbProjectGroup::getId, groupId));
        if (nameConflict) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "项目组名称已存在");
        }

        WbProjectGroup update = new WbProjectGroup();
        update.setId(groupId);
        update.setName(req.getName());
        update.setDescription(req.getDescription());
        update.setUpdatedBy(operatorId);
        groupMapper.updateById(update);

        return GroupSettingsResponse.from(groupMapper.selectById(groupId));
    }

    public PageResult<MemberResponse> listMembers(Long groupId, PageQuery query) {
        Page<MemberResponse> pageParam = query.toMyBatisPage();
        return PageResult.of(memberMapper.selectMembersWithUser(pageParam, groupId, query.getKeyword()));
    }

    public PageResult<AvailableUserResponse> listAvailableUsers(Long groupId, PageQuery query) {
        Page<WbUser> pageParam = query.toMyBatisPage();
        return PageResult.of(userMapper.selectAvailableUsers(pageParam, groupId, query.getKeyword()))
                .convert(AvailableUserResponse::from);
    }


    @Transactional
    public MemberResponse addMember(Long groupId, AddMemberRequest req, Long operatorId) {
        WbUser user = userMapper.selectById(req.getUserId());
        ensureAddableUser(user);

        boolean alreadyMember = memberMapper.exists(new LambdaQueryWrapper<WbProjectGroupMember>()
                .eq(WbProjectGroupMember::getGroupId, groupId)
                .eq(WbProjectGroupMember::getUserId, req.getUserId()));
        if (alreadyMember) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "该用户已是本项目组成员");
        }

        WbProjectGroupMember member = new WbProjectGroupMember();
        member.setGroupId(groupId);
        member.setUserId(req.getUserId());
        member.setRole(req.getRole());
        member.setCreatedBy(operatorId);
        member.setUpdatedBy(operatorId);
        memberMapper.insert(member);

        WbProjectGroupMember inserted = memberMapper.selectById(member.getId());
        return toMemberResponse(inserted, user);
    }

    @Transactional
    public void addMembers(Long groupId, AddMembersRequest req, Long operatorId) {
        List<Long> requestedUserIds = req.getUserIds().stream()
                .distinct()
                .toList();

        List<WbUser> users = userMapper.selectBatchIds(requestedUserIds);
        Map<Long, WbUser> userMap = users.stream()
                .collect(Collectors.toMap(WbUser::getId, Function.identity()));

        for (Long userId : requestedUserIds) {
            ensureAddableUser(userMap.get(userId));
        }

        Set<Long> existingUserIds = memberMapper.selectList(new LambdaQueryWrapper<WbProjectGroupMember>()
                        .eq(WbProjectGroupMember::getGroupId, groupId)
                        .in(WbProjectGroupMember::getUserId, requestedUserIds))
                .stream()
                .map(WbProjectGroupMember::getUserId)
                .collect(Collectors.toSet());
        if (!existingUserIds.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "所选用户中存在已加入本项目组的成员");
        }

        List<WbProjectGroupMember> members = requestedUserIds.stream()
                .map(userId -> {
                    WbProjectGroupMember member = new WbProjectGroupMember();
                    member.setGroupId(groupId);
                    member.setUserId(userId);
                    member.setRole(req.getRole());
                    member.setCreatedBy(operatorId);
                    member.setUpdatedBy(operatorId);
                    return member;
                })
                .toList();
        memberService.saveBatch(members);
    }


    @Transactional
    public void updateMemberRole(Long groupId, Long memberId, UpdateMemberRoleRequest req, Long operatorId) {
        WbProjectGroupMember member = requireMemberInGroup(groupId, memberId);

        if (Objects.equals(member.getUserId(), operatorId)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "不可修改自己的角色");
        }

        if (GroupRole.GROUP_ADMIN.name().equals(member.getRole()) && GroupRole.DEVELOPER.name().equals(req.getRole())) {
            long adminCount = memberMapper.selectCount(new LambdaQueryWrapper<WbProjectGroupMember>()
                    .eq(WbProjectGroupMember::getGroupId, member.getGroupId())
                    .eq(WbProjectGroupMember::getRole, GroupRole.GROUP_ADMIN.name()));
            if (adminCount <= 1) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "该成员是唯一的项目组管理员，无法降级");
            }
        }

        WbProjectGroupMember update = new WbProjectGroupMember();
        update.setId(memberId);
        update.setRole(req.getRole());
        update.setUpdatedBy(operatorId);
        memberMapper.updateById(update);
    }


    @Transactional
    public void removeMember(Long groupId, Long memberId, Long operatorId) {
        WbProjectGroupMember member = requireMemberInGroup(groupId, memberId);

        if (Objects.equals(member.getUserId(), operatorId)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "不可移除自己");
        }

        if (GroupRole.GROUP_ADMIN.name().equals(member.getRole())) {
            long adminCount = memberMapper.selectCount(new LambdaQueryWrapper<WbProjectGroupMember>()
                    .eq(WbProjectGroupMember::getGroupId, member.getGroupId())
                    .eq(WbProjectGroupMember::getRole, GroupRole.GROUP_ADMIN.name()));
            if (adminCount <= 1) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "该成员是唯一的项目组管理员，无法移除");
            }
        }

        memberMapper.deleteById(memberId);
    }

    private WbProjectGroupMember requireMemberInGroup(Long groupId, Long memberId) {
        WbProjectGroupMember member = memberMapper.selectById(memberId);
        if (member == null || !Objects.equals(member.getGroupId(), groupId)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "成员记录不存在");
        }
        return member;
    }


    private MemberResponse toMemberResponse(WbProjectGroupMember member, WbUser user) {
        MemberResponse resp = new MemberResponse();
        resp.setId(member.getId());
        resp.setUserId(member.getUserId());
        resp.setUsername(user != null ? user.getUsername() : null);
        resp.setDisplayName(user != null ? user.getDisplayName() : null);
        resp.setRole(member.getRole());
        resp.setCreatedAt(member.getCreatedAt());
        return resp;
    }

    private void ensureAddableUser(WbUser user) {
        if (user == null || !"ACTIVE".equals(user.getStatus())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "指定的用户不存在或已禁用");
        }
        if (isSystemAdmin(user)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, SYSTEM_ADMIN_MEMBER_REASON);
        }
    }

    private boolean isSystemAdmin(WbUser user) {
        return SystemRole.SYSTEM_ADMIN.name().equals(user.getSystemRole());
    }
}
