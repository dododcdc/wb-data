package com.wbdata.user.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.wbdata.user.entity.WbUser;

import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import org.apache.ibatis.annotations.Param;

public interface WbUserMapper extends BaseMapper<WbUser> {
    
    IPage<WbUser> selectAvailableUsers(Page<WbUser> page, @Param("groupId") Long groupId, @Param("keyword") String keyword);
}
