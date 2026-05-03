package com.wbdata.group.dto;

import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import lombok.Data;

import java.util.List;

@Data
public class AddMembersRequest {

    @NotEmpty(message = "请至少选择一名用户")
    private List<@NotNull(message = "用户不能为空") Long> userIds;

    @NotBlank(message = "请选择项目组角色")
    @Pattern(regexp = "^(GROUP_ADMIN|DEVELOPER)$", message = "角色必须为 GROUP_ADMIN 或 DEVELOPER")
    private String role;
}
