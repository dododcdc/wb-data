package com.wbdata.offline.dto;

import jakarta.validation.constraints.NotNull;

public record CommitRequest(
        @NotNull Long groupId,
        String message
) {}
