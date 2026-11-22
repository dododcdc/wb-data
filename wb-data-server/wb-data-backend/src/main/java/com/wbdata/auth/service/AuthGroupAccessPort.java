package com.wbdata.auth.service;

import com.wbdata.auth.dto.ProjectGroupContextItem;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

/**
 * auth 域对项目组上下文、成员角色及偏好访问记录的窄端口，由 group 包的适配器实现。
 */
public interface AuthGroupAccessPort {

    record AuthGroupSnapshot(Long id, String name, String status, String memberRole) {}

    List<ProjectGroupContextItem> listActiveGroupsForSystemAdmin();

    List<ProjectGroupContextItem> listActiveGroupsForUser(Long userId);

    Optional<AuthGroupSnapshot> findGroupAccess(Long groupId, Long userId, boolean includeMembership);

    Optional<Long> findLastSelectedGroupId(Long userId);

    void recordGroupSelection(Long userId, Long groupId, LocalDateTime accessedAt);
}
