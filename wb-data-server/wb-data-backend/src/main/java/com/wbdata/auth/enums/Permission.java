package com.wbdata.auth.enums;

public enum Permission {
    DATASOURCE_READ("datasource.read"),
    DATASOURCE_WRITE("datasource.write"),
    QUERY_USE("query.use"),
    QUERY_EXPORT("query.export"),
    OFFLINE_READ("offline.read"),
    OFFLINE_WRITE("offline.write"),
    MEMBER_READ("member.read"),
    MEMBER_MANAGE("member.manage"),
    GROUP_SETTINGS("group.settings");

    private final String code;

    Permission(String code) {
        this.code = code;
    }

    public String code() {
        return code;
    }
}
