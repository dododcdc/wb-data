package com.wbdata.user.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.wbdata.auth.service.AuthUserAccountPort;
import com.wbdata.user.entity.WbUser;
import com.wbdata.user.mapper.WbUserMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.Optional;

/**
 * auth 域用户账号端口的适配器：将认证查询与登录时间更新委托给 {@link WbUserMapper}。
 */
@Service
@RequiredArgsConstructor
public class UserAuthAccountAdapter implements AuthUserAccountPort {

    private final WbUserMapper userMapper;

    @Override
    public Optional<AuthUserAccount> findByUsername(String username) {
        WbUser user = userMapper.selectOne(new LambdaQueryWrapper<WbUser>()
                .eq(WbUser::getUsername, username)
                .last("LIMIT 1"));
        return Optional.ofNullable(user).map(UserAuthAccountAdapter::toAuthUserAccount);
    }

    @Override
    public Optional<AuthUserAccount> findById(Long userId) {
        return Optional.ofNullable(userMapper.selectById(userId))
                .map(UserAuthAccountAdapter::toAuthUserAccount);
    }

    @Override
    public void updateLastLoginAt(Long userId, LocalDateTime lastLoginAt) {
        WbUser update = new WbUser();
        update.setId(userId);
        update.setLastLoginAt(lastLoginAt);
        userMapper.updateById(update);
    }

    public static AuthUserAccount toAuthUserAccount(WbUser user) {
        long version = user.getAuthVersion() == null ? 0L : user.getAuthVersion();
        return new AuthUserAccount(
                user.getId(),
                user.getUsername(),
                user.getDisplayName(),
                user.getPasswordHash(),
                user.getSystemRole(),
                user.getStatus(),
                version
        );
    }
}
