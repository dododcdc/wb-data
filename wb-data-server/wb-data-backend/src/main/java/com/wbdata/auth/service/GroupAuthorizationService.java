package com.wbdata.auth.service;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.wbdata.auth.context.GroupAuthContext;
import com.wbdata.auth.enums.Permission;
import com.wbdata.auth.enums.SystemRole;
import com.wbdata.group.entity.WbProjectGroup;
import com.wbdata.group.entity.WbProjectGroupMember;
import com.wbdata.group.mapper.WbProjectGroupMapper;
import com.wbdata.group.mapper.WbProjectGroupMemberMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

@Service
@RequiredArgsConstructor
public class GroupAuthorizationService {
    private final WbProjectGroupMapper groupMapper;
    private final WbProjectGroupMemberMapper memberMapper;
    private final PermissionService permissionService;

    public GroupAuthContext requireGroup(AuthSession session, Long groupId, Permission permission) {
        boolean systemAdmin = SystemRole.SYSTEM_ADMIN.name().equals(session.systemRole());
        WbProjectGroup group = groupMapper.selectById(groupId);
        if (group == null) {
            throw new ResponseStatusException(systemAdmin ? HttpStatus.NOT_FOUND : HttpStatus.FORBIDDEN,
                    "项目组不存在或无权访问");
        }
        if (!"active".equals(group.getStatus())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "项目组已禁用");
        }

        String role = null;
        if (!systemAdmin) {
            WbProjectGroupMember member = memberMapper.selectOne(Wrappers.<WbProjectGroupMember>lambdaQuery()
                    .eq(WbProjectGroupMember::getGroupId, groupId)
                    .eq(WbProjectGroupMember::getUserId, session.id()));
            if (member == null) {
                throw new ResponseStatusException(HttpStatus.FORBIDDEN, "无权访问该项目组");
            }
            role = member.getRole();
        }
        if (!permissionService.resolveProjectPermissions(role, systemAdmin).contains(permission.code())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "当前项目组下无此操作权限: " + permission.code());
        }
        return new GroupAuthContext(session, group.getId(), group.getName());
    }
}
