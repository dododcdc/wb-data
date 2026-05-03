package com.wbdata.group.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.wbdata.group.entity.WbProjectGroupMember;

import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.wbdata.group.dto.MemberResponse;
import org.apache.ibatis.annotations.Param;

public interface WbProjectGroupMemberMapper extends BaseMapper<WbProjectGroupMember> {
    
    IPage<MemberResponse> selectMembersWithUser(Page<MemberResponse> page, @Param("groupId") Long groupId, @Param("keyword") String keyword);
}
