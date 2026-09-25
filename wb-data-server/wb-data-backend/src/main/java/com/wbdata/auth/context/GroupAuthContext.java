package com.wbdata.auth.context;

import com.wbdata.auth.service.AuthSession;

public record GroupAuthContext(AuthSession user, Long groupId, String groupName) {
}
