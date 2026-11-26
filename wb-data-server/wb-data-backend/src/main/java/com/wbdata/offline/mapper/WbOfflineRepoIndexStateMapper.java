package com.wbdata.offline.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.wbdata.offline.entity.WbOfflineRepoIndexState;
import org.apache.ibatis.annotations.Select;

import java.util.List;

public interface WbOfflineRepoIndexStateMapper extends BaseMapper<WbOfflineRepoIndexState> {

    @Select("""
            SELECT group_id
            FROM wb_offline_repo_index_state
            """)
    List<Long> findAllGroupIds();
}
