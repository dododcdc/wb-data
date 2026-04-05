package com.wbdata.user.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import lombok.Data;

@Data
public class UpdateUserStatusRequest {

    @NotBlank(message = "状态不能为空")
    @Pattern(regexp = "^(ACTIVE|DISABLED)$", message = "状态只能是 ACTIVE 或 DISABLED")
    private String status;
}
