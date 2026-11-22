package com.wbdata.user.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.wbdata.auth.service.AuthUserAccountPort;
import com.wbdata.user.entity.WbUser;
import com.wbdata.user.mapper.WbUserMapper;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.time.LocalDateTime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class UserAuthAccountAdapterTest {

    private final WbUserMapper userMapper = mock(WbUserMapper.class);
    private final UserAuthAccountAdapter adapter = new UserAuthAccountAdapter(userMapper);

    @Test
    void findByUsernameAndFindByIdMapNullableAuthVersionSafely() {
        WbUser user = new WbUser();
        user.setId(7L);
        user.setUsername("alice");
        user.setDisplayName("Alice");
        user.setPasswordHash("bcrypt-hash");
        user.setSystemRole("USER");
        user.setStatus("ACTIVE");
        user.setAuthVersion(null);
        when(userMapper.selectOne(any(LambdaQueryWrapper.class))).thenReturn(user);
        when(userMapper.selectById(7L)).thenReturn(user);

        AuthUserAccountPort.AuthUserAccount byName = adapter.findByUsername("alice").orElseThrow();
        AuthUserAccountPort.AuthUserAccount byId = adapter.findById(7L).orElseThrow();

        assertThat(byName).isEqualTo(new AuthUserAccountPort.AuthUserAccount(
                7L, "alice", "Alice", "bcrypt-hash", "USER", "ACTIVE", 0L));
        assertThat(byId).isEqualTo(byName);
    }

    @Test
    void findMissingUserReturnsEmpty() {
        when(userMapper.selectOne(any(LambdaQueryWrapper.class))).thenReturn(null);
        when(userMapper.selectById(99L)).thenReturn(null);

        assertThat(adapter.findByUsername("missing")).isEmpty();
        assertThat(adapter.findById(99L)).isEmpty();
    }

    @Test
    void updateLastLoginAtUpdatesOnlyIdAndTimestamp() {
        LocalDateTime now = LocalDateTime.of(2026, 11, 22, 20, 0);

        adapter.updateLastLoginAt(7L, now);

        ArgumentCaptor<WbUser> captor = ArgumentCaptor.forClass(WbUser.class);
        verify(userMapper).updateById(captor.capture());
        assertThat(captor.getValue().getId()).isEqualTo(7L);
        assertThat(captor.getValue().getLastLoginAt()).isEqualTo(now);
        assertThat(captor.getValue().getUsername()).isNull();
    }
}
