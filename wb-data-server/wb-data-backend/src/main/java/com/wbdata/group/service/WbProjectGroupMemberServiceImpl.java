package com.wbdata.group.service;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.wbdata.group.entity.WbProjectGroupMember;
import com.wbdata.group.mapper.WbProjectGroupMemberMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class WbProjectGroupMemberServiceImpl extends ServiceImpl<WbProjectGroupMemberMapper, WbProjectGroupMember> implements WbProjectGroupMemberService {
}