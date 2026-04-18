package com.wbdata.git.dto;

import jakarta.validation.constraints.NotBlank;

public record SaveGitConfigRequest(
    @NotBlank(message = "Provider 不能为空") String provider,
    @NotBlank(message = "用户名不能为空") String username,
    String token,
    String baseUrl
) {}
