package com.wbdata.offline.credential.dto;

public record GitCredentialResponse(
        Long groupId,
        String provider,
        String repositoryUrl,
        String username,
        String token
) {
}
