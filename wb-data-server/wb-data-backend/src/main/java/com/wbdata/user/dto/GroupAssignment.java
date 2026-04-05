package com.wbdata.user.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import lombok.Data;

@Data
public class GroupAssignment {
    @NotNull(message = "请选择项目组")
    private Long groupId;

    @NotNull(message = "请选择项目组角色")
    @Pattern(regexp = "GROUP_ADMIN|DEVELOPER", message = "角色必须是 GROUP_ADMIN 或 DEVELOPER")
    private String groupRole;
}
