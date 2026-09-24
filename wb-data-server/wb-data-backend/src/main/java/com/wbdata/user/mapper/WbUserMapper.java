package com.wbdata.user.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.wbdata.user.entity.WbUser;

import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

public interface WbUserMapper extends BaseMapper<WbUser> {
    
    IPage<WbUser> selectAvailableUsers(Page<WbUser> page, @Param("groupId") Long groupId, @Param("keyword") String keyword);

    @Select("SELECT * FROM wb_user WHERE id = #{userId} FOR UPDATE")
    WbUser selectForUpdate(@Param("userId") Long userId);

    @Update("UPDATE wb_user SET auth_version = auth_version + 1 WHERE id = #{userId}")
    int incrementAuthVersion(@Param("userId") Long userId);
}
