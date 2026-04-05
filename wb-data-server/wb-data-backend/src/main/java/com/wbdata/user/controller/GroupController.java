package com.wbdata.user.controller;

import com.wbdata.auth.dto.CurrentUserResponse;
import com.wbdata.auth.service.AuthTokenService;
import com.wbdata.common.Result;
import com.wbdata.group.entity.WbProjectGroup;
import com.wbdata.group.mapper.WbProjectGroupMapper;
import com.wbdata.user.dto.GroupSimpleResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.stream.Collectors;

@Tag(name = "项目组", description = "项目组查询（SYSTEM_ADMIN 专属）")
@RestController
@RequestMapping("/api/v1/groups")
@RequiredArgsConstructor
public class GroupController {

    private final WbProjectGroupMapper groupMapper;
    private final AuthTokenService authTokenService;

    @Operation(summary = "所有项目组列表")
    @GetMapping
    public Result<List<GroupSimpleResponse>> listAll(
            @RequestHeader(HttpHeaders.AUTHORIZATION) String authorization) {
        requireSystemAdmin(authorization);
        List<WbProjectGroup> groups = groupMapper.selectList(null);
        List<GroupSimpleResponse> result = groups.stream()
                .map(GroupSimpleResponse::from)
                .collect(Collectors.toList());
        return Result.success(result);
    }

    private void requireSystemAdmin(String authorization) {
        CurrentUserResponse user = authTokenService.getCurrentUser(authorization);
        if (!"SYSTEM_ADMIN".equals(user.systemRole())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "需要系统管理员权限");
        }
    }
}
