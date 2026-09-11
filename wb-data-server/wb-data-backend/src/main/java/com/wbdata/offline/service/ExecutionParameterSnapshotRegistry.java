package com.wbdata.offline.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.wbdata.offline.dto.FlowParameterSnapshot;
import com.wbdata.offline.mapper.ExecutionParameterSnapshotMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.ZoneId;
import java.util.HexFormat;
import java.util.Optional;

@Service
@RequiredArgsConstructor
public class ExecutionParameterSnapshotRegistry {

    public static final String LABEL_KEY = "wbdataParameterSnapshotId";

    private final ExecutionParameterSnapshotMapper mapper;
    private final ObjectMapper objectMapper;

    public String register(Long groupId, FlowParameterSnapshot snapshot) {
        if (snapshot.schemaVersion() != 2
                || snapshot.runtimeTimezone() == null
                || snapshot.runtimeTimezone().isBlank()) {
            throw new IllegalArgumentException("执行参数快照必须包含 Flow 运行时区并使用 schemaVersion 2");
        }
        try {
            ZoneId.of(snapshot.runtimeTimezone());
        } catch (RuntimeException ex) {
            throw new IllegalArgumentException("执行参数快照中的 Flow 运行时区不合法", ex);
        }
        try {
            String json = objectMapper.writeValueAsString(snapshot);
            String snapshotId = sha256(json);
            mapper.insertIgnore(groupId, snapshotId, json);
            return snapshotId;
        } catch (JsonProcessingException ex) {
            throw new IllegalStateException("序列化执行参数快照失败", ex);
        }
    }

    public Optional<FlowParameterSnapshot> find(Long groupId, String snapshotId) {
        if (snapshotId == null || snapshotId.isBlank()) {
            return Optional.empty();
        }
        String json = mapper.findJson(groupId, snapshotId);
        if (json == null) {
            return Optional.empty();
        }
        try {
            return Optional.of(FlowParameterSnapshotCodec.read(objectMapper, json));
        } catch (FlowParameterSnapshotCodec.UnsupportedSchemaVersionException ex) {
            throw new IllegalStateException("不支持的执行参数快照版本: " + ex.schemaVersion(), ex);
        } catch (JsonProcessingException ex) {
            throw new IllegalStateException("解析执行参数快照失败", ex);
        }
    }

    private String sha256(String value) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(digest.digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException("计算执行参数快照指纹失败", ex);
        }
    }
}
