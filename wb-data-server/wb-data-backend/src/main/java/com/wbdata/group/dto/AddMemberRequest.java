package com.wbdata.group.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import lombok.Data;

@Data
public class AddMemberRequest {

    @NotNull(message = "请选择用户")
    private Long userId;

    @NotBlank(message = "请选择项目组角色")
    @Pattern(regexp = "^(GROUP_ADMIN|DEVELOPER)$", message = "角色必须为 GROUP_ADMIN 或 DEVELOPER")
    private String role;
}
