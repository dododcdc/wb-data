package com.wbdata.ownership.controller;

import com.wbdata.auth.context.AuthContext;
import com.wbdata.auth.context.GroupAuthContext;
import com.wbdata.auth.context.RequireGroupAuth;
import com.wbdata.auth.enums.Permission;
import com.wbdata.auth.service.AuthSession;
import com.wbdata.common.Result;
import com.wbdata.ownership.dto.GroupAssetHandoverRequest;
import com.wbdata.ownership.dto.GroupAssetHandoverResponse;
import com.wbdata.ownership.dto.GroupMemberAssetSummaryResponse;
import com.wbdata.ownership.dto.UserAssetHandoverRequest;
import com.wbdata.ownership.dto.UserAssetHandoverResponse;
import com.wbdata.ownership.dto.UserAssetSummaryResponse;
import com.wbdata.ownership.service.AssetOwnershipHandoverService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@Tag(name = "资产交接", description = "成员移出/用户停用前的名下资产统计与一键交接")
@RestController
@RequiredArgsConstructor
public class AssetHandoverController {

    private final AssetOwnershipHandoverService handoverService;

    @Operation(summary = "查询成员在当前项目组名下的资产数量")
    @GetMapping({
            "/api/v1/group-settings/members/{userId}/assets",
            "/api/v1/groups/{groupId}/settings/members/{userId}/assets"
    })
    public Result<GroupMemberAssetSummaryResponse> getGroupMemberAssets(
            @RequireGroupAuth(Permission.MEMBER_MANAGE) GroupAuthContext context,
            @PathVariable Long userId) {
        return Result.success(handoverService.getGroupMemberAssetSummary(context.groupId(), userId));
    }

    @Operation(summary = "一键交接成员在当前项目组名下的全部资产")
    @PostMapping({
            "/api/v1/group-settings/members/{userId}/handover",
            "/api/v1/groups/{groupId}/settings/members/{userId}/handover"
    })
    public Result<GroupAssetHandoverResponse> handoverGroupMemberAssets(
            @RequireGroupAuth(Permission.MEMBER_MANAGE) GroupAuthContext context,
            @PathVariable Long userId,
            @Valid @RequestBody GroupAssetHandoverRequest request) {
        return Result.success(handoverService.handoverGroupMemberAssets(
                context.groupId(),
                userId,
                request.targetOwnerUserId(),
                context.user().id()
        ));
    }

    @Operation(summary = "查询用户跨全部项目组名下的资产汇总（SYSTEM_ADMIN）")
    @GetMapping("/api/v1/users/{userId}/assets")
    public Result<UserAssetSummaryResponse> getUserAssets(@PathVariable Long userId) {
        AuthContext.requireSystemAdmin();
        return Result.success(handoverService.getUserAssetSummary(userId));
    }

    @Operation(summary = "按项目组批量交接用户名下的全部资产（SYSTEM_ADMIN）")
    @PostMapping("/api/v1/users/{userId}/handover")
    public Result<UserAssetHandoverResponse> handoverUserAssets(
            @PathVariable Long userId,
            @Valid @RequestBody UserAssetHandoverRequest request) {
        AuthSession operator = AuthContext.requireSystemAdmin();
        return Result.success(handoverService.handoverUserAssets(userId, request, operator.id()));
    }
}
