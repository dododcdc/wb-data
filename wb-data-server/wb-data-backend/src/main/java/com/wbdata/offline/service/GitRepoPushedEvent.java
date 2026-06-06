package com.wbdata.offline.service;

public record GitRepoPushedEvent(Long groupId, String branch) {
}
