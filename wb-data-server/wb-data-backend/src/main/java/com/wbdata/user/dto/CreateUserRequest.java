package com.wbdata.user.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import lombok.Data;

import java.util.List;

@Data
public class CreateUserRequest {

    @NotBlank(message = "请输入用户名")
    @Size(min = 2, max = 64, message = "用户名只能包含字母、数字、下划线和短横线，长度 2-64")
    @Pattern(regexp = "^[a-zA-Z0-9_-]+$", message = "用户名只能包含字母、数字、下划线和短横线，长度 2-64")
    private String username;

    @NotBlank(message = "请输入展示名")
    @Size(max = 64, message = "展示名不能超过 64 个字符")
    private String displayName;

    @NotBlank(message = "请输入密码")
    @Size(min = 8, max = 64, message = "密码需 8-64 位，至少包含字母和数字")
    @Pattern(regexp = "^(?=.*[a-zA-Z])(?=.*\\d).+$", message = "密码需 8-64 位，至少包含字母和数字")
    private String password;

    private String systemRole = "USER";

    @Valid
    private List<GroupAssignment> groupAssignments;
}
