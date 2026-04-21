package com.wbdata.group.dto;

import com.wbdata.group.entity.WbProjectGroup;
import lombok.Data;

import java.time.LocalDateTime;

@Data
public class GroupDetailResponse {

    private Long id;
    private String name;
    private String description;
    private String status;
    private Long memberCount;
    private LocalDateTime createdAt;

    public static GroupDetailResponse from(WbProjectGroup group, Long memberCount) {
        GroupDetailResponse resp = new GroupDetailResponse();
        resp.setId(group.getId());
        resp.setName(group.getName());
        resp.setDescription(group.getDescription());
        resp.setStatus(group.getStatus());
        resp.setMemberCount(memberCount);
        resp.setCreatedAt(group.getCreatedAt());
        return resp;
    }
}
