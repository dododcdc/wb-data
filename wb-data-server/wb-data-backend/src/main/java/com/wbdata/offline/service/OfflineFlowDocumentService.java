package com.wbdata.offline.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.wbdata.offline.config.OfflineProperties;
import com.wbdata.offline.dto.NodePosition;
import com.wbdata.offline.dto.DebugDocumentExecutionRequest;
import com.wbdata.offline.dto.OfflineFlowDocumentResponse;
import com.wbdata.offline.dto.OfflineFlowEdgeResponse;
import com.wbdata.offline.dto.OfflineFlowNodeResponse;
import com.wbdata.offline.dto.OfflineFlowStageResponse;
import com.wbdata.offline.dto.SaveOfflineFlowDocumentRequest;
import com.wbdata.offline.dto.SaveOfflineFlowEdgeRequest;
import com.wbdata.offline.dto.SaveOfflineFlowNodeRequest;
import com.wbdata.offline.dto.SaveOfflineFlowStageRequest;
import com.wbdata.datasource.service.DataSourceService;
import com.wbdata.datasource.entity.DataSource;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

@Service
@RequiredArgsConstructor
public class OfflineFlowDocumentService {

    public record CompiledFlowDraft(
            String content,
            Map<String, String> namespaceFileContents
    ) {
    }

    private record GraphDraft(
            List<OfflineFlowYamlSupport.FlowNode> nodes,
            List<OfflineFlowYamlSupport.FlowEdge> edges,
            Map<Long, DataSource> dataSourceMap,
            Map<String, String> namespaceFileContents
    ) {
    }

    private final OfflineProperties offlineProperties;
    private final OfflineFlowContentService offlineFlowContentService;
    private final DataSourceService dataSourceService;
    private final OfflineFlowGraphValidation graphValidation = new OfflineFlowGraphValidation();
    private final OfflineFlowYamlSupport yamlSupport = new OfflineFlowYamlSupport();
    private final ObjectMapper objectMapper = new ObjectMapper();

    public OfflineFlowDocumentResponse getFlowDocument(Long groupId, String path) {
        try {
            return readSnapshot(groupId, path).response();
        } catch (IOException ex) {
            throw new IllegalStateException("读取 Flow 文档失败", ex);
        }
    }

    public OfflineFlowDocumentResponse saveFlowDocument(SaveOfflineFlowDocumentRequest request) {
        try {
            Path repoPath = offlineProperties.resolveRepoPath(request.groupId());
            Path flowFile = resolveRepoFile(repoPath, request.path());
            boolean isNewFile = !Files.exists(flowFile);

            if (request.edges() != null) {
                // New graph-based save: compile DAG back to YAML
                String flowSource = isNewFile
                        ? yamlSupport.buildEmptyFlowYaml(extractFlowId(request.path()), "pg-" + request.groupId())
                        : offlineFlowContentService.getFlowContent(request.groupId(), request.path()).content();
                DocumentSnapshot current = null;
                if (!isNewFile && request.documentHash() != null) {
                    current = readSnapshot(request.groupId(), request.path());
                }
                if (current != null && request.documentHash() != null
                        && (!current.response().documentHash().equals(request.documentHash())
                        || current.response().documentUpdatedAt() != request.documentUpdatedAt())) {
                    throw new ResponseStatusException(HttpStatus.CONFLICT, "检测到文件已被修改，请先加载最新内容");
                }
                saveWithGraph(request, flowSource);
            } else {
                // Legacy stage-based save
                if (isNewFile) {
                    // For new flows, create a stub YAML with id, namespace, and empty tasks
                    String flowId = extractFlowId(request.path());
                    String namespace = "pg-" + request.groupId();
                    String stubYaml = yamlSupport.buildEmptyFlowYaml(flowId, namespace);
                    Files.createDirectories(flowFile.getParent());
                    Files.writeString(flowFile, stubYaml, StandardCharsets.UTF_8);
                }
                DocumentSnapshot current = readSnapshot(request.groupId(), request.path());
                if (!isNewFile && (request.documentHash() != null
                        && (!current.response().documentHash().equals(request.documentHash())
                        || current.response().documentUpdatedAt() != request.documentUpdatedAt()))) {
                    throw new ResponseStatusException(HttpStatus.CONFLICT, "检测到文件已被修改，请先加载最新内容");
                }
                saveWithStages(request, current);
            }

            // Save layout.json if provided
            if (request.layout() != null && !request.layout().isEmpty()) {
                saveLayout(request.groupId(), request.path(), request.layout());
            }

            return readSnapshot(request.groupId(), request.path()).response();
        } catch (IOException ex) {
            throw new IllegalStateException("保存 Flow 文档失败", ex);
        }
    }

    public CompiledFlowDraft compileFlowDraft(DebugDocumentExecutionRequest request) {
        try {
            DocumentSnapshot current = readSnapshot(request.groupId(), request.flowPath());
            if (request.documentHash() != null
                    && (!current.response().documentHash().equals(request.documentHash())
                    || current.response().documentUpdatedAt() != request.documentUpdatedAt())) {
                throw new ResponseStatusException(HttpStatus.CONFLICT, "检测到文件已被修改，请先加载最新内容");
            }

            GraphDraft draft = prepareGraphDraft(
                    request.groupId(),
                    request.stages(),
                    request.edges()
            );
            var flowContent = offlineFlowContentService.getFlowContent(request.groupId(), request.flowPath());
            String compiledYaml = yamlSupport.compileGraph(
                    flowContent.content(),
                    draft.nodes(),
                    draft.edges(),
                    draft.dataSourceMap()
            );
            return new CompiledFlowDraft(compiledYaml, draft.namespaceFileContents());
        } catch (IOException ex) {
            throw new IllegalStateException("编译 Flow 文档失败", ex);
        }
    }

    private String extractFlowId(String path) {
        // path format: _flows/{folder}/{name}/flow.yaml
        String[] parts = path.split("/");
        if (parts.length >= 2) {
            return parts[parts.length - 2];
        }
        return "flow";
    }

    private void saveWithGraph(SaveOfflineFlowDocumentRequest request, String flowSource) throws IOException {
        Path repoPath = offlineProperties.resolveRepoPath(request.groupId());
        GraphDraft graphDraft = prepareGraphDraft(request.groupId(), request.stages(), request.edges());
        graphValidation.assertNoImplicitDependencies(graphDraft.nodes(), graphDraft.edges());

        writeGraphScripts(repoPath, graphDraft);

        // 3. Compile graph to YAML and write flow.yaml
        String compiledYaml = yamlSupport.compileGraph(
                flowSource,
                graphDraft.nodes(),
                graphDraft.edges(),
                graphDraft.dataSourceMap()
        );
        Path flowFile = resolveRepoFile(repoPath, request.path());
        Files.createDirectories(flowFile.getParent());
        Files.writeString(flowFile, compiledYaml, StandardCharsets.UTF_8);
    }

    private void writeGraphScripts(Path repoPath, GraphDraft graphDraft) throws IOException {
        for (Map.Entry<String, String> entry : graphDraft.namespaceFileContents().entrySet()) {
            Path scriptFile = resolveRepoFile(repoPath, entry.getKey());
            Files.createDirectories(scriptFile.getParent());
            Files.writeString(scriptFile, entry.getValue(), StandardCharsets.UTF_8);
        }
    }

    private GraphDraft prepareGraphDraft(Long groupId,
                                         List<SaveOfflineFlowStageRequest> stages,
                                         List<SaveOfflineFlowEdgeRequest> requestEdges) throws IOException {
        Path repoPath = offlineProperties.resolveRepoPath(groupId);
        List<OfflineFlowYamlSupport.FlowNode> nodes = new ArrayList<>();
        Set<Long> dataSourceIds = new LinkedHashSet<>();
        Map<String, String> namespaceFileContents = new LinkedHashMap<>();

        for (SaveOfflineFlowStageRequest stage : stages) {
            for (SaveOfflineFlowNodeRequest nodeReq : stage.nodes()) {
                nodes.add(new OfflineFlowYamlSupport.FlowNode(
                        nodeReq.taskId(),
                        nodeReq.kind(),
                        nodeReq.scriptPath(),
                        nodeReq.dataSourceId(),
                        nodeReq.dataSourceType()
                ));
                if (nodeReq.dataSourceId() != null) {
                    dataSourceIds.add(nodeReq.dataSourceId());
                }

                namespaceFileContents.put(nodeReq.scriptPath(), nodeReq.scriptContent());
            }
        }

        Map<Long, DataSource> dataSourceMap = new LinkedHashMap<>();
        for (Long dsId : dataSourceIds) {
            DataSource ds = dataSourceService.getById(dsId);
            if (ds != null) {
                dataSourceMap.put(dsId, ds);
            }
        }

        List<OfflineFlowYamlSupport.FlowEdge> edges = requestEdges.stream()
                .map(e -> new OfflineFlowYamlSupport.FlowEdge(e.source(), e.target()))
                .toList();

        return new GraphDraft(nodes, edges, dataSourceMap, namespaceFileContents);
    }

    private void saveWithStages(SaveOfflineFlowDocumentRequest request, DocumentSnapshot current) throws IOException {
        validateStructure(current, request);

        Map<String, SaveOfflineFlowNodeRequest> requestedNodes = flattenRequestedNodes(request.stages());
        for (Map.Entry<String, Path> entry : current.taskFiles().entrySet()) {
            SaveOfflineFlowNodeRequest node = requestedNodes.get(entry.getKey());
            if (node == null) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "当前版本仅支持编辑已有节点内容");
            }
            Files.writeString(entry.getValue(), node.scriptContent(), StandardCharsets.UTF_8);
        }
    }

    private OfflineFlowNodeResponse findNodeInResponse(OfflineFlowDocumentResponse response, String taskId) {
        for (OfflineFlowStageResponse stage : response.stages()) {
            for (OfflineFlowNodeResponse node : stage.nodes()) {
                if (node.taskId().equals(taskId)) return node;
            }
        }
        return null;
    }

    private DocumentSnapshot readSnapshot(Long groupId, String path) throws IOException {
        var flow = offlineFlowContentService.getFlowContent(groupId, path);
        Path repoPath = offlineProperties.resolveRepoPath(groupId);

        // Parse both stage-based and graph-based representations
        OfflineFlowYamlSupport.FlowDocument document = yamlSupport.parseDocument(flow.content());
        OfflineFlowYamlSupport.FlowGraph graph = yamlSupport.parseGraph(flow.content());

        List<OfflineFlowStageResponse> stages = new ArrayList<>();
        Map<String, Path> taskFiles = new LinkedHashMap<>();
        Set<String> seenTaskIds = new LinkedHashSet<>();
        List<String> stageKeys = new ArrayList<>();
        List<String> taskOrder = new ArrayList<>();
        long updatedAt = flow.fileUpdatedAt();
        StringBuilder signature = new StringBuilder()
                .append(path)
                .append('\n')
                .append(flow.content());

        for (OfflineFlowYamlSupport.FlowStage stage : document.stages()) {
            stageKeys.add(stage.stageId());
            List<OfflineFlowNodeResponse> nodes = new ArrayList<>();
            for (OfflineFlowYamlSupport.FlowNode node : stage.nodes()) {
                if (!seenTaskIds.add(node.taskId())) {
                    throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Flow YAML 中存在重复 taskId");
                }
                Path scriptFile = resolveRepoFile(repoPath, node.scriptPath());
                if (!Files.isRegularFile(scriptFile)) {
                    throw new ResponseStatusException(HttpStatus.NOT_FOUND, "脚本文件不存在: " + node.scriptPath());
                }
                String scriptContent = Files.readString(scriptFile, StandardCharsets.UTF_8);
                updatedAt = Math.max(updatedAt, Files.getLastModifiedTime(scriptFile).toMillis());
                signature.append('\n')
                        .append(node.taskId())
                        .append('\n')
                        .append(node.scriptPath())
                        .append('\n')
                        .append(scriptContent);
                taskFiles.put(node.taskId(), scriptFile);
                taskOrder.add(node.taskId());
                nodes.add(new OfflineFlowNodeResponse(
                        node.taskId(),
                        node.kind(),
                        node.scriptPath(),
                        scriptContent,
                        node.dataSourceId(),
                        node.dataSourceType()
                ));
            }
            stages.add(new OfflineFlowStageResponse(stage.stageId(), stage.parallel(), nodes));
        }

        // Build edges from graph
        List<OfflineFlowEdgeResponse> edges = graph.edges().stream()
                .map(e -> new OfflineFlowEdgeResponse(e.source(), e.target()))
                .toList();

        // Read layout.json if it exists
        Map<String, NodePosition> layout = readLayout(groupId, path);

        return new DocumentSnapshot(
                new OfflineFlowDocumentResponse(
                        groupId,
                        path,
                        document.flowId(),
                        document.namespace(),
                        yamlSupport.sha256Hex(signature.toString()),
                        updatedAt,
                        stages,
                        edges,
                        layout
                ),
                taskFiles,
                stageKeys,
                taskOrder
        );
    }

    private Map<String, NodePosition> readLayout(Long groupId, String path) {
        try {
            Path repoPath = offlineProperties.resolveRepoPath(groupId);
            Path layoutFile = resolveLayoutFile(repoPath, path);
            if (!Files.isRegularFile(layoutFile)) {
                return Collections.emptyMap();
            }
            String json = Files.readString(layoutFile, StandardCharsets.UTF_8);
            return objectMapper.readValue(json, new TypeReference<>() {});
        } catch (IOException ex) {
            return Collections.emptyMap();
        }
    }

    private void saveLayout(Long groupId, String path, Map<String, NodePosition> layout) throws IOException {
        Path repoPath = offlineProperties.resolveRepoPath(groupId);
        Path layoutFile = resolveLayoutFile(repoPath, path);
        Files.createDirectories(layoutFile.getParent());
        String json = objectMapper.writerWithDefaultPrettyPrinter().writeValueAsString(layout);
        Files.writeString(layoutFile, json, StandardCharsets.UTF_8);
    }

    private Path resolveLayoutFile(Path repoPath, String flowPath) {
        // flow.yaml → .layout.json in the same directory
        Path flowFile = Path.of(flowPath).normalize();
        Path parent = flowFile.getParent();
        String layoutName = ".layout.json";
        Path layoutRelative = parent != null ? parent.resolve(layoutName) : Path.of(layoutName);
        Path resolved = repoPath.resolve(layoutRelative).normalize();
        if (!resolved.startsWith(repoPath)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "布局文件路径不合法");
        }
        return resolved;
    }

    private void validateStructure(DocumentSnapshot current, SaveOfflineFlowDocumentRequest request) {
        List<String> requestedStages = request.stages().stream()
                .map(SaveOfflineFlowStageRequest::stageId)
                .toList();
        if (!current.stageOrder().equals(requestedStages)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "当前版本仅支持编辑已有节点内容");
        }

        List<String> requestedTaskOrder = request.stages().stream()
                .flatMap(stage -> stage.nodes().stream())
                .map(SaveOfflineFlowNodeRequest::taskId)
                .toList();
        if (!current.taskOrder().equals(requestedTaskOrder)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "当前版本仅支持编辑已有节点内容");
        }
    }

    private Map<String, SaveOfflineFlowNodeRequest> flattenRequestedNodes(List<SaveOfflineFlowStageRequest> stages) {
        Map<String, SaveOfflineFlowNodeRequest> nodes = new LinkedHashMap<>();
        for (SaveOfflineFlowStageRequest stage : stages) {
            for (SaveOfflineFlowNodeRequest node : stage.nodes()) {
                nodes.put(node.taskId(), node);
            }
        }
        return nodes;
    }

    private Path resolveRepoFile(Path repoPath, String path) {
        if (path == null || path.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "脚本文件路径不能为空");
        }
        Path relativePath = Path.of(path).normalize();
        if (relativePath.isAbsolute()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "脚本文件路径不合法");
        }

        Path resolvedPath = repoPath.resolve(relativePath).normalize();
        if (!resolvedPath.startsWith(repoPath)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "脚本文件路径不合法");
        }
        return resolvedPath;
    }

    private record DocumentSnapshot(
            OfflineFlowDocumentResponse response,
            Map<String, Path> taskFiles,
            List<String> stageOrder,
            List<String> taskOrder
    ) {
    }
}
