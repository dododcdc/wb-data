package com.wbdata.group.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.wbdata.group.dto.CreateGroupRequest;
import com.wbdata.group.dto.GroupDetailResponse;
import com.wbdata.group.dto.UpdateGroupRequest;
import com.wbdata.group.entity.WbProjectGroup;
import com.wbdata.group.entity.WbProjectGroupMember;
import com.wbdata.group.mapper.WbProjectGroupMapper;
import com.wbdata.group.mapper.WbProjectGroupMemberMapper;
import com.wbdata.git.service.GitConfigService;
import com.wbdata.offline.config.OfflineProperties;
import com.wbdata.user.dto.GroupSimpleResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class GroupService {

    private final WbProjectGroupMapper groupMapper;
    private final WbProjectGroupMemberMapper groupMemberMapper;
    private final OfflineProperties offlineProperties;
    private final GitConfigService gitConfigService;

    public List<GroupSimpleResponse> listAll() {
        LambdaQueryWrapper<WbProjectGroup> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(WbProjectGroup::getStatus, "active");
        List<WbProjectGroup> groups = groupMapper.selectList(wrapper);
        return groups.stream()
                .map(GroupSimpleResponse::from)
                .collect(Collectors.toList());
    }

    public IPage<GroupDetailResponse> listGroups(int page, int size, String keyword) {
        Page<WbProjectGroup> pageParam = new Page<>(page, size);
        LambdaQueryWrapper<WbProjectGroup> wrapper = new LambdaQueryWrapper<>();

        if (keyword != null && !keyword.isBlank()) {
            String kw = "%" + keyword.trim() + "%";
            wrapper.like(WbProjectGroup::getName, kw);
        }

        wrapper.orderByDesc(WbProjectGroup::getCreatedAt);
        IPage<WbProjectGroup> result = groupMapper.selectPage(pageParam, wrapper);

        List<WbProjectGroup> records = result.getRecords();
        if (records.isEmpty()) {
            return result.convert(g -> GroupDetailResponse.from(g, 0L));
        }

        List<Long> groupIds = records.stream().map(WbProjectGroup::getId).toList();
        Map<Long, Long> memberCountMap = countMembersByGroupIds(groupIds);

        return result.convert(g ->
                GroupDetailResponse.from(g, memberCountMap.getOrDefault(g.getId(), 0L)));
    }

    @Transactional
    public GroupDetailResponse createGroup(CreateGroupRequest req, Long operatorId) {
        boolean exists = groupMapper.exists(new LambdaQueryWrapper<WbProjectGroup>()
                .eq(WbProjectGroup::getName, req.getName()));
        if (exists) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "项目组名称已存在");
        }

        WbProjectGroup group = new WbProjectGroup();
        group.setName(req.getName());
        group.setDescription(req.getDescription());
        group.setCreatedBy(operatorId);
        group.setUpdatedBy(operatorId);
        groupMapper.insert(group);

        initLocalRepo(group.getId());

        // 可选：初始化 Git 远程仓库配置
        CreateGroupRequest.GitConfigSetup git = req.getGitConfig();
        if (git != null && git.getProvider() != null && !git.getProvider().isBlank()
                && git.getUsername() != null && !git.getUsername().isBlank()
                && git.getToken() != null && !git.getToken().isBlank()) {
            gitConfigService.saveConfig(
                    group.getId(),
                    git.getProvider(),
                    git.getUsername(),
                    git.getToken(),
                    git.getBaseUrl(),
                    operatorId
            );
        }

        return GroupDetailResponse.from(groupMapper.selectById(group.getId()), 0L);
    }

    @Transactional
    public void deleteGroup(Long groupId) {
        WbProjectGroup group = groupMapper.selectById(groupId);
        if (group == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "项目组不存在");
        }

        long memberCount = groupMemberMapper.selectCount(
                new LambdaQueryWrapper<WbProjectGroupMember>()
                        .eq(WbProjectGroupMember::getGroupId, groupId));
        if (memberCount > 0) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "该项目组尚有成员，无法删除");
        }

        groupMapper.deleteById(groupId);
    }

    @Transactional
    public GroupDetailResponse updateGroup(Long groupId, UpdateGroupRequest req, Long operatorId) {
        WbProjectGroup group = groupMapper.selectById(groupId);
        if (group == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "项目组不存在");
        }

        boolean exists = groupMapper.exists(new LambdaQueryWrapper<WbProjectGroup>()
                .eq(WbProjectGroup::getName, req.name())
                .ne(WbProjectGroup::getId, groupId));
        if (exists) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "项目组名称已存在");
        }

        group.setName(req.name());
        group.setDescription(req.description());
        group.setUpdatedBy(operatorId);
        groupMapper.updateById(group);

        long memberCount = groupMemberMapper.selectCount(
                new LambdaQueryWrapper<WbProjectGroupMember>()
                        .eq(WbProjectGroupMember::getGroupId, groupId));

        return GroupDetailResponse.from(group, memberCount);
    }

    @Transactional
    public GroupDetailResponse disableGroup(Long groupId) {
        return setGroupStatus(groupId, "disabled");
    }

    @Transactional
    public GroupDetailResponse enableGroup(Long groupId) {
        return setGroupStatus(groupId, "active");
    }

    private GroupDetailResponse setGroupStatus(Long groupId, String status) {
        WbProjectGroup group = groupMapper.selectById(groupId);
        if (group == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "项目组不存在");
        }
        group.setStatus(status);
        groupMapper.updateById(group);
        long memberCount = groupMemberMapper.selectCount(
                new LambdaQueryWrapper<WbProjectGroupMember>()
                        .eq(WbProjectGroupMember::getGroupId, groupId));
        return GroupDetailResponse.from(group, memberCount);
    }

    private Map<Long, Long> countMembersByGroupIds(List<Long> groupIds) {
        List<WbProjectGroupMember> members = groupMemberMapper.selectList(
                new LambdaQueryWrapper<WbProjectGroupMember>()
                        .in(WbProjectGroupMember::getGroupId, groupIds));
        return members.stream()
                .collect(Collectors.groupingBy(WbProjectGroupMember::getGroupId, Collectors.counting()));
    }

    private void initLocalRepo(Long groupId) {
        Path repoPath = offlineProperties.resolveRepoPath(groupId);
        try {
            Files.createDirectories(repoPath);
            Files.createDirectories(repoPath.resolve("_flows"));
            Files.createDirectories(repoPath.resolve("scripts"));
            Files.writeString(repoPath.resolve("_flows/.gitkeep"), "", StandardCharsets.UTF_8);
            Files.writeString(repoPath.resolve("scripts/.gitkeep"), "", StandardCharsets.UTF_8);
            runGitCommand(repoPath, "init", "--initial-branch=main");
        } catch (IOException ex) {
            throw new IllegalStateException("初始化本地仓库失败: " + repoPath, ex);
        }
    }

    private String runGitCommand(Path repoPath, String... args) {
        List<String> command = new java.util.ArrayList<>();
        command.add("git");
        command.add("-C");
        command.add(repoPath.toString());
        command.addAll(List.of(args));
        try {
            Process process = new ProcessBuilder(command)
                    .redirectErrorStream(true)
                    .start();
            if (!process.waitFor(10, TimeUnit.SECONDS)) {
                process.destroyForcibly();
                throw new IllegalStateException("执行 git 命令超时: " + String.join(" ", command));
            }
            String output = new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8).trim();
            if (process.exitValue() != 0) {
                throw new IllegalStateException("执行 git 命令失败: " + output);
            }
            return output;
        } catch (IOException ex) {
            throw new IllegalStateException("执行 git 命令失败", ex);
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("执行 git 命令被中断", ex);
        }
    }
}
