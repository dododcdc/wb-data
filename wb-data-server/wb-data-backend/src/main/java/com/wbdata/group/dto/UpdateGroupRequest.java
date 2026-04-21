package com.wbdata.group.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record UpdateGroupRequest(
        @NotBlank(message = "项目组名称不能为空") @Size(min = 2, max = 64, message = "项目组名称长度需在 2-64 之间") String name,
        @Size(max = 255, message = "描述不能超过 255 个字符") String description
) {}
