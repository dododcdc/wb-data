package com.wbdata.user.dto;

import com.wbdata.group.entity.WbProjectGroup;
import lombok.Data;

@Data
public class GroupSimpleResponse {

    private Long id;
    private String name;
    private String description;
    private String status;

    public static GroupSimpleResponse from(WbProjectGroup group) {
        GroupSimpleResponse resp = new GroupSimpleResponse();
        resp.setId(group.getId());
        resp.setName(group.getName());
        resp.setDescription(group.getDescription());
        resp.setStatus(group.getStatus());
        return resp;
    }
}
