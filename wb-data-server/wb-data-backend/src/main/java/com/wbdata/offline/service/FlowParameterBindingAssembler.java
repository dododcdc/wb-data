package com.wbdata.offline.service;

import com.wbdata.offline.dto.FlowParameterBindingItemResponse;
import com.wbdata.offline.dto.FlowParameterBindingRequest;
import com.wbdata.offline.dto.FlowParameterBindingResponse;
import com.wbdata.offline.dto.FlowParameterDefinitionSnapshot;
import com.wbdata.offline.dto.FlowParameterGroupBindingSnapshot;
import com.wbdata.offline.dto.FlowParameterSnapshot;
import com.wbdata.parameter.dto.ParameterDefinitionResponse;
import com.wbdata.parameter.dto.ParameterGroupResponse;
import com.wbdata.parameter.service.ParameterGroupService;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

@Component
public class FlowParameterBindingAssembler {

    public record ParameterSnapshotUpdate(boolean requested, FlowParameterSnapshot snapshot) {
    }

    private final ParameterGroupService parameterGroupService;
    private final FlowParameterSnapshotStore parameterSnapshotStore;

    public FlowParameterBindingAssembler(ParameterGroupService parameterGroupService,
                                         FlowParameterSnapshotStore parameterSnapshotStore) {
        this.parameterGroupService = parameterGroupService;
        this.parameterSnapshotStore = parameterSnapshotStore;
    }

    public ParameterSnapshotUpdate prepareParameterSnapshotUpdate(Long groupId,
                                                                  FlowParameterBindingRequest singleBinding,
                                                                  List<FlowParameterBindingRequest> multipleBindings,
                                                                  String runtimeTimezone) {
        List<FlowParameterBindingRequest> bindings;
        if (multipleBindings != null) {
            bindings = multipleBindings;
        } else if (singleBinding != null) {
            bindings = List.of(singleBinding);
        } else {
            return new ParameterSnapshotUpdate(false, null);
        }

        if (bindings.isEmpty() || (bindings.size() == 1 && bindings.get(0).parameterGroupId() == null)) {
            FlowParameterBindingRequest first = bindings.isEmpty() ? null : bindings.get(0);
            if (first != null && first.expectedVersion() != null) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                        "解除参数组绑定时不能提供 expectedVersion");
            }
            return new ParameterSnapshotUpdate(true, null);
        }

        List<FlowParameterGroupBindingSnapshot> groupSnapshots = new ArrayList<>();
        Map<String, FlowParameterDefinitionSnapshot> mergedDefinitions = new LinkedHashMap<>();

        for (FlowParameterBindingRequest binding : bindings) {
            if (binding.parameterGroupId() == null) {
                continue;
            }
            if (binding.expectedVersion() == null) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "绑定参数组时必须提供 expectedVersion");
            }

            ParameterGroupResponse group = parameterGroupService.get(groupId, binding.parameterGroupId());
            if ("ARCHIVED".equals(group.status())) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "已归档的参数组不能绑定到任务");
            }
            if (!group.version().equals(binding.expectedVersion())) {
                throw new ResponseStatusException(HttpStatus.CONFLICT, "参数组版本已变化，请刷新后重试");
            }

            List<FlowParameterDefinitionSnapshot> groupDefs = group.definitions().stream()
                    .map(this::toSnapshotDefinition)
                    .toList();

            groupSnapshots.add(new FlowParameterGroupBindingSnapshot(
                    group.code(),
                    group.version(),
                    groupDefs
            ));

            for (FlowParameterDefinitionSnapshot def : groupDefs) {
                mergedDefinitions.putIfAbsent(def.key(), def);
            }
        }

        if (groupSnapshots.isEmpty()) {
            return new ParameterSnapshotUpdate(true, null);
        }

        FlowParameterGroupBindingSnapshot firstGroup = groupSnapshots.get(0);
        FlowParameterSnapshot snapshot = new FlowParameterSnapshot(
                2,
                runtimeTimezone,
                firstGroup.groupCode(),
                firstGroup.groupVersion(),
                new ArrayList<>(mergedDefinitions.values()),
                groupSnapshots
        );
        return new ParameterSnapshotUpdate(true, snapshot);
    }

    public ParameterSnapshotUpdate normalizeParameterSnapshotForSave(ParameterSnapshotUpdate requestedUpdate,
                                                                     FlowParameterSnapshot effectiveSnapshot,
                                                                     String runtimeTimezone) {
        if (effectiveSnapshot == null) {
            return requestedUpdate;
        }
        if (effectiveSnapshot.schemaVersion() == 2
                && runtimeTimezone.equals(effectiveSnapshot.runtimeTimezone())) {
            return requestedUpdate;
        }
        return new ParameterSnapshotUpdate(true, new FlowParameterSnapshot(
                2,
                runtimeTimezone,
                effectiveSnapshot.groupCode(),
                effectiveSnapshot.groupVersion(),
                effectiveSnapshot.definitions(),
                effectiveSnapshot.groups()
        ));
    }

    public void applyParameterSnapshotUpdate(Path repoPath,
                                             String flowPath,
                                             ParameterSnapshotUpdate update) throws IOException {
        if (!update.requested()) {
            return;
        }
        if (update.snapshot() == null) {
            parameterSnapshotStore.delete(repoPath, flowPath);
        } else {
            parameterSnapshotStore.write(repoPath, flowPath, update.snapshot());
        }
    }

    public FlowParameterSnapshot resolveEffectiveParameterSnapshot(Path repoPath,
                                                                   String flowPath,
                                                                   ParameterSnapshotUpdate update) throws IOException {
        if (update.requested()) {
            return update.snapshot();
        }
        return parameterSnapshotStore.read(repoPath, flowPath)
                .map(FlowParameterSnapshotStore.SnapshotFile::snapshot)
                .orElse(null);
    }

    public FlowParameterBindingResponse resolveParameterBinding(Long groupId, FlowParameterSnapshot snapshot) {
        if (snapshot == null) {
            return null;
        }

        if (snapshot.groups() != null && !snapshot.groups().isEmpty()) {
            List<FlowParameterBindingItemResponse> itemResponses = new ArrayList<>();
            Map<String, FlowParameterDefinitionSnapshot> mergedDefs = new LinkedHashMap<>();
            boolean anyOutdated = false;
            boolean anyArchived = false;
            boolean anyMissing = false;

            for (FlowParameterGroupBindingSnapshot groupSnapshot : snapshot.groups()) {
                Optional<ParameterGroupResponse> current = parameterGroupService.findByCode(groupId, groupSnapshot.groupCode());
                if (current.isEmpty()) {
                    anyMissing = true;
                    itemResponses.add(new FlowParameterBindingItemResponse(
                            null,
                            groupSnapshot.groupCode(),
                            null,
                            groupSnapshot.groupVersion(),
                            null,
                            "MISSING",
                            groupSnapshot.definitions()
                    ));
                } else {
                    ParameterGroupResponse group = current.get();
                    String status;
                    if ("ARCHIVED".equals(group.status())) {
                        status = "ARCHIVED";
                        anyArchived = true;
                    } else if (group.version().equals(groupSnapshot.groupVersion())) {
                        status = "CURRENT";
                    } else {
                        status = "OUTDATED";
                        anyOutdated = true;
                    }
                    itemResponses.add(new FlowParameterBindingItemResponse(
                            group.id(),
                            groupSnapshot.groupCode(),
                            group.name(),
                            groupSnapshot.groupVersion(),
                            group.version(),
                            status,
                            groupSnapshot.definitions()
                    ));
                }

                if (groupSnapshot.definitions() != null) {
                    for (FlowParameterDefinitionSnapshot def : groupSnapshot.definitions()) {
                        mergedDefs.putIfAbsent(def.key(), def);
                    }
                }
            }

            FlowParameterBindingItemResponse firstItem = itemResponses.get(0);
            String compositeStatus = anyMissing ? "MISSING" : anyArchived ? "ARCHIVED" : anyOutdated ? "OUTDATED" : "CURRENT";

            return new FlowParameterBindingResponse(
                    firstItem.parameterGroupId(),
                    firstItem.code(),
                    firstItem.name(),
                    firstItem.boundVersion(),
                    firstItem.currentVersion(),
                    compositeStatus,
                    new ArrayList<>(mergedDefs.values()),
                    itemResponses
            );
        }

        Optional<ParameterGroupResponse> current = parameterGroupService.findByCode(groupId, snapshot.groupCode());
        if (current.isEmpty()) {
            FlowParameterBindingItemResponse item = new FlowParameterBindingItemResponse(
                    null,
                    snapshot.groupCode(),
                    null,
                    snapshot.groupVersion(),
                    null,
                    "MISSING",
                    snapshot.definitions()
            );
            return new FlowParameterBindingResponse(
                    null,
                    snapshot.groupCode(),
                    null,
                    snapshot.groupVersion(),
                    null,
                    "MISSING",
                    snapshot.definitions(),
                    List.of(item)
            );
        }

        ParameterGroupResponse group = current.get();
        String status;
        if ("ARCHIVED".equals(group.status())) {
            status = "ARCHIVED";
        } else if (group.version().equals(snapshot.groupVersion())) {
            status = "CURRENT";
        } else {
            status = "OUTDATED";
        }
        FlowParameterBindingItemResponse item = new FlowParameterBindingItemResponse(
                group.id(),
                snapshot.groupCode(),
                group.name(),
                snapshot.groupVersion(),
                group.version(),
                status,
                snapshot.definitions()
        );
        return new FlowParameterBindingResponse(
                group.id(),
                snapshot.groupCode(),
                group.name(),
                snapshot.groupVersion(),
                group.version(),
                status,
                snapshot.definitions(),
                List.of(item)
        );
    }

    private FlowParameterDefinitionSnapshot toSnapshotDefinition(ParameterDefinitionResponse definition) {
        return new FlowParameterDefinitionSnapshot(
                definition.key(),
                definition.valueSource(),
                definition.constantValue(),
                definition.format(),
                definition.offsetDays(),
                definition.description(),
                definition.sortOrder(),
                definition.timeBasis()
        );
    }
}
