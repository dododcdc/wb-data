package com.wbdata.user.service;

import java.util.Collection;
import java.util.List;

/**
 * user 域对用户项目组成员关系的窄端口，由 group 包的适配器实现。
 */
public interface UserGroupMembershipPort {

    record AssignedGroup(Long groupId, String groupName, String groupRole) {}

    record MembershipSpec(Long groupId, String groupRole) {}

    void assertGroupsExist(Collection<Long> groupIds);

    void assignMemberships(Long userId, List<MembershipSpec> assignments, Long operatorId);

    void syncMemberships(Long userId, List<MembershipSpec> assignments, Long operatorId);

    List<AssignedGroup> listUserGroups(Long userId);
}
