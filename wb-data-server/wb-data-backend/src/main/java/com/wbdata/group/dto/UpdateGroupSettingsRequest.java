package com.wbdata.group.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import lombok.Data;

@Data
public class UpdateGroupSettingsRequest {

    @NotBlank(message = "请输入项目组名称")
    @Size(min = 2, max = 64, message = "项目组名称只能包含字母、数字、下划线和短横线，长度 2-64")
    @Pattern(regexp = "^[a-zA-Z0-9_-]+$", message = "项目组名称只能包含字母、数字、下划线和短横线，长度 2-64")
    private String name;

    @Size(max = 255, message = "描述不能超过 255 个字符")
    private String description;
}
