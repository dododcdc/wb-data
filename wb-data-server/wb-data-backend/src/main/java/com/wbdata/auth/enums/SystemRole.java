package com.wbdata.auth.enums;

public enum SystemRole {
    SYSTEM_ADMIN,
    USER;

    public boolean isSystemAdmin() {
        return this == SYSTEM_ADMIN;
    }
}
