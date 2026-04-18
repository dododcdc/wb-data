package com.wbdata.git.dto;

public record GitConfigResponse(
    Long id,
    String provider,
    String username,
    String tokenMasked,
    String baseUrl
) {}
