package com.wbdata.user.dto;

import jakarta.validation.constraints.NotNull;
import lombok.Data;

@Data
public class GroupAssignment {
    @NotNull(message = "请选择项目组")
    private Long groupId;

    @NotNull(message = "请选择项目组角色")
    private String groupRole;
}
