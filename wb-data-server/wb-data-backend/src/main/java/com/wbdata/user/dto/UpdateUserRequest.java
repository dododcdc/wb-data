package com.wbdata.user.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.Data;

import java.util.List;

@Data
public class UpdateUserRequest {

    @NotBlank(message = "请输入展示名")
    @Size(max = 64, message = "展示名不能超过 64 个字符")
    private String displayName;

    private String systemRole;

    @Valid
    private List<GroupAssignment> groupAssignments;
}
