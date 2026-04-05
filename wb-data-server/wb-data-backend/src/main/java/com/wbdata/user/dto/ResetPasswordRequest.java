package com.wbdata.user.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import lombok.Data;

@Data
public class ResetPasswordRequest {

    @NotBlank(message = "请输入密码")
    @Size(min = 8, max = 64, message = "密码需 8-64 位，至少包含字母和数字")
    @Pattern(regexp = "^(?=.*[a-zA-Z])(?=.*\\d).+$", message = "密码需 8-64 位，至少包含字母和数字")
    private String newPassword;
}
