package com.wbdata.offline.repo.service;

public record GitRepoPushedEvent(
        Long publishRecordId,
        Long groupId,
        String branch,
        String beforeSha,
        String afterSha
) {
}
