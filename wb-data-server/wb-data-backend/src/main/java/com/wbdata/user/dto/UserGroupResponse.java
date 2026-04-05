package com.wbdata.user.dto;

import lombok.Data;

@Data
public class UserGroupResponse {
    private Long groupId;
    private String groupName;
    private String groupRole;
}
