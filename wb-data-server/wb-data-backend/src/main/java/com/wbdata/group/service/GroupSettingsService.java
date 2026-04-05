package com.wbdata.group.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
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

    private final WbProjectGroupMapper groupMapper;
    private final WbProjectGroupMemberMapper memberMapper;
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

    public IPage<MemberResponse> listMembers(Long groupId, int page, int size, String keyword) {
        LambdaQueryWrapper<WbProjectGroupMember> memberWrapper = new LambdaQueryWrapper<WbProjectGroupMember>()
                .eq(WbProjectGroupMember::getGroupId, groupId);
        memberWrapper.orderByAsc(WbProjectGroupMember::getRole);
        memberWrapper.orderByAsc(WbProjectGroupMember::getCreatedAt);

        if (keyword != null && !keyword.isBlank()) {
            return listMembersWithKeyword(groupId, page, size, keyword.trim());
        }

        Page<WbProjectGroupMember> pageParam = new Page<>(page, size);
        IPage<WbProjectGroupMember> memberPage = memberMapper.selectPage(pageParam, memberWrapper);

        if (memberPage.getRecords().isEmpty()) {
            return memberPage.convert(m -> new MemberResponse());
        }

        List<Long> userIds = memberPage.getRecords().stream()
                .map(WbProjectGroupMember::getUserId).toList();
        Map<Long, WbUser> userMap = userMapper.selectBatchIds(userIds).stream()
                .collect(Collectors.toMap(WbUser::getId, Function.identity()));

        return memberPage.convert(m -> toMemberResponse(m, userMap.get(m.getUserId())));
    }

    private IPage<MemberResponse> listMembersWithKeyword(Long groupId, int page, int size, String keyword) {
        List<WbProjectGroupMember> allMembers = memberMapper.selectList(
                new LambdaQueryWrapper<WbProjectGroupMember>()
                        .eq(WbProjectGroupMember::getGroupId, groupId));

        if (allMembers.isEmpty()) {
            Page<MemberResponse> emptyPage = new Page<>(page, size);
            emptyPage.setTotal(0);
            emptyPage.setRecords(List.of());
            return emptyPage;
        }

        List<Long> allUserIds = allMembers.stream().map(WbProjectGroupMember::getUserId).toList();
        Map<Long, WbUser> userMap = userMapper.selectBatchIds(allUserIds).stream()
                .collect(Collectors.toMap(WbUser::getId, Function.identity()));

        String kw = keyword.toLowerCase();
        List<WbProjectGroupMember> filtered = allMembers.stream()
                .filter(m -> {
                    WbUser u = userMap.get(m.getUserId());
                    if (u == null) return false;
                    return (u.getUsername() != null && u.getUsername().toLowerCase().contains(kw))
                            || (u.getDisplayName() != null && u.getDisplayName().toLowerCase().contains(kw));
                })
                .sorted((a, b) -> {
                    int roleCmp = a.getRole().compareTo(b.getRole());
                    if (roleCmp != 0) return roleCmp;
                    if (a.getCreatedAt() == null || b.getCreatedAt() == null) return 0;
                    return a.getCreatedAt().compareTo(b.getCreatedAt());
                })
                .toList();

        long total = filtered.size();
        int fromIndex = (page - 1) * size;
        int toIndex = Math.min(fromIndex + size, filtered.size());
        List<MemberResponse> records = (fromIndex >= filtered.size())
                ? List.of()
                : filtered.subList(fromIndex, toIndex).stream()
                .map(m -> toMemberResponse(m, userMap.get(m.getUserId())))
                .toList();

        Page<MemberResponse> result = new Page<>(page, size);
        result.setTotal(total);
        result.setRecords(records);
        return result;
    }


    public List<AvailableUserResponse> listAvailableUsers(Long groupId, String keyword) {
        List<WbProjectGroupMember> existingMembers = memberMapper.selectList(
                new LambdaQueryWrapper<WbProjectGroupMember>()
                        .eq(WbProjectGroupMember::getGroupId, groupId)
                        .select(WbProjectGroupMember::getUserId));
        Set<Long> existingUserIds = existingMembers.stream()
                .map(WbProjectGroupMember::getUserId)
                .collect(Collectors.toSet());

        LambdaQueryWrapper<WbUser> userWrapper = new LambdaQueryWrapper<WbUser>()
                .eq(WbUser::getStatus, "ACTIVE");
        if (!existingUserIds.isEmpty()) {
            userWrapper.notIn(WbUser::getId, existingUserIds);
        }
        if (keyword != null && !keyword.isBlank()) {
            String kw = "%" + keyword.trim() + "%";
            userWrapper.and(w -> w.like(WbUser::getUsername, kw)
                    .or().like(WbUser::getDisplayName, kw));
        }
        userWrapper.last("LIMIT 50");

        return userMapper.selectList(userWrapper).stream()
                .map(AvailableUserResponse::from)
                .toList();
    }


    @Transactional
    public MemberResponse addMember(Long groupId, AddMemberRequest req, Long operatorId) {
        WbUser user = userMapper.selectById(req.getUserId());
        if (user == null || !"ACTIVE".equals(user.getStatus())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "指定的用户不存在或已禁用");
        }

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
    public void updateMemberRole(Long memberId, UpdateMemberRoleRequest req, Long operatorId) {
        WbProjectGroupMember member = memberMapper.selectById(memberId);
        if (member == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "成员记录不存在");
        }

        if (Objects.equals(member.getUserId(), operatorId)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "不可修改自己的角色");
        }

        if ("GROUP_ADMIN".equals(member.getRole()) && "DEVELOPER".equals(req.getRole())) {
            long adminCount = memberMapper.selectCount(new LambdaQueryWrapper<WbProjectGroupMember>()
                    .eq(WbProjectGroupMember::getGroupId, member.getGroupId())
                    .eq(WbProjectGroupMember::getRole, "GROUP_ADMIN"));
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
    public void removeMember(Long memberId, Long operatorId) {
        WbProjectGroupMember member = memberMapper.selectById(memberId);
        if (member == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "成员记录不存在");
        }

        if (Objects.equals(member.getUserId(), operatorId)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "不可移除自己");
        }

        if ("GROUP_ADMIN".equals(member.getRole())) {
            long adminCount = memberMapper.selectCount(new LambdaQueryWrapper<WbProjectGroupMember>()
                    .eq(WbProjectGroupMember::getGroupId, member.getGroupId())
                    .eq(WbProjectGroupMember::getRole, "GROUP_ADMIN"));
            if (adminCount <= 1) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "该成员是唯一的项目组管理员，无法移除");
            }
        }

        memberMapper.deleteById(memberId);
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
}
