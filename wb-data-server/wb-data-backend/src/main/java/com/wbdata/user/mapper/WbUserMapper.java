package com.wbdata.user.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.wbdata.user.entity.WbUser;
import org.apache.ibatis.annotations.Mapper;

@Mapper
public interface WbUserMapper extends BaseMapper<WbUser> {
}
