package com.wbdata.group.service;

import com.wbdata.group.dto.CreateGroupRequest;
import com.wbdata.group.dto.GroupDetailResponse;
import com.wbdata.group.entity.WbProjectGroup;
import com.wbdata.group.mapper.WbProjectGroupMapper;
import com.wbdata.group.mapper.WbProjectGroupMemberMapper;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.context.ApplicationEventPublisher;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class GroupServiceTest {

    private final WbProjectGroupMapper groupMapper = mock(WbProjectGroupMapper.class);
    private final WbProjectGroupMemberMapper memberMapper = mock(WbProjectGroupMemberMapper.class);
    private final ApplicationEventPublisher eventPublisher = mock(ApplicationEventPublisher.class);
    private final GroupService service = new GroupService(groupMapper, memberMapper, eventPublisher);

    @Test
    void createGroupPublishesGroupCreatedEventWithInsertedId() {
        when(groupMapper.exists(any())).thenReturn(false);
        when(groupMapper.insert(any(WbProjectGroup.class))).thenAnswer(invocation -> {
            invocation.<WbProjectGroup>getArgument(0).setId(42L);
            return 1;
        });
        WbProjectGroup persisted = new WbProjectGroup();
        persisted.setId(42L);
        persisted.setName("analytics");
        persisted.setStatus("active");
        when(groupMapper.selectById(42L)).thenReturn(persisted);

        CreateGroupRequest req = new CreateGroupRequest();
        req.setName("analytics");
        req.setDescription("Analytics group");

        GroupDetailResponse response = service.createGroup(req, 7L);

        assertThat(response.getId()).isEqualTo(42L);
        ArgumentCaptor<Object> eventCaptor = ArgumentCaptor.forClass(Object.class);
        verify(eventPublisher).publishEvent(eventCaptor.capture());
        assertThat(eventCaptor.getValue()).isEqualTo(new GroupCreatedEvent(42L));
    }

    @Test
    void createGroupPropagatesEventListenerFailureForTransactionalRollback() {
        when(groupMapper.exists(any())).thenReturn(false);
        when(groupMapper.insert(any(WbProjectGroup.class))).thenAnswer(invocation -> {
            invocation.<WbProjectGroup>getArgument(0).setId(42L);
            return 1;
        });
        doThrow(new IllegalStateException("初始化本地仓库失败"))
                .when(eventPublisher).publishEvent(any(Object.class));

        CreateGroupRequest req = new CreateGroupRequest();
        req.setName("analytics");

        assertThatThrownBy(() -> service.createGroup(req, 7L))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("初始化本地仓库失败");
    }
}
