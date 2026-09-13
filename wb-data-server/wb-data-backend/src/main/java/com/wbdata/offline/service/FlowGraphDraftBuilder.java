package com.wbdata.offline.service;

import com.wbdata.datasource.entity.DataSource;
import com.wbdata.datasource.service.DataSourceService;
import com.wbdata.offline.dto.SaveOfflineFlowEdgeRequest;
import com.wbdata.offline.dto.SaveOfflineFlowNodeRequest;
import com.wbdata.offline.dto.SaveOfflineFlowStageRequest;
import com.wbdata.offline.transfer.dto.TransferConfig;
import com.wbdata.offline.transfer.service.TransferConfigFileService;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

@Component
public class FlowGraphDraftBuilder {

    public record GraphDraft(
            List<OfflineFlowNode> nodes,
            List<OfflineFlowYamlSupport.FlowEdge> edges,
            Map<Long, DataSource> dataSourceMap,
            Map<String, String> scriptFileContents,
            Map<String, TransferConfig> transferConfigs,
            Map<String, String> namespaceFileContents
    ) {
    }

    private final DataSourceService dataSourceService;
    private final TransferConfigFileService transferConfigFileService;

    public FlowGraphDraftBuilder(DataSourceService dataSourceService,
                                 TransferConfigFileService transferConfigFileService) {
        this.dataSourceService = dataSourceService;
        this.transferConfigFileService = transferConfigFileService;
    }

    public GraphDraft prepare(Long groupId,
                              String flowPath,
                              List<SaveOfflineFlowStageRequest> stages,
                              List<SaveOfflineFlowEdgeRequest> requestEdges) throws IOException {
        List<OfflineFlowNode> nodes = new ArrayList<>();
        Set<Long> dataSourceIds = new LinkedHashSet<>();
        Map<String, String> namespaceFileContents = new LinkedHashMap<>();
        Map<String, String> scriptFileContents = new LinkedHashMap<>();
        Map<String, TransferConfig> transferConfigs = new LinkedHashMap<>();

        for (SaveOfflineFlowStageRequest stage : stages) {
            for (SaveOfflineFlowNodeRequest nodeReq : stage.nodes()) {
                boolean transferNode = "TRANSFER".equalsIgnoreCase(nodeReq.kind());
                String transferConfigPath = transferNode
                        ? transferConfigFileService.buildPath(flowPath, nodeReq.taskId())
                        : null;
                nodes.add(new OfflineFlowNode(
                        nodeReq.taskId(),
                        nodeReq.kind(),
                        nodeReq.scriptPath(),
                        nodeReq.dataSourceId(),
                        nodeReq.dataSourceType(),
                        transferConfigPath
                ));
                if (nodeReq.dataSourceId() != null) {
                    dataSourceIds.add(nodeReq.dataSourceId());
                }

                if (transferNode) {
                    transferConfigs.put(nodeReq.taskId(), nodeReq.transfer());
                    namespaceFileContents.put(transferConfigPath,
                            transferConfigFileService.serialize(groupId, flowPath, nodeReq.taskId(), nodeReq.transfer()));
                } else {
                    scriptFileContents.put(nodeReq.scriptPath(), nodeReq.scriptContent());
                    namespaceFileContents.put(nodeReq.scriptPath(), nodeReq.scriptContent());
                }
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

        return new GraphDraft(nodes, edges, dataSourceMap, scriptFileContents, transferConfigs, namespaceFileContents);
    }

    public void writeFiles(Path repoPath, Long groupId, String flowPath, GraphDraft graphDraft) throws IOException {
        for (Map.Entry<String, String> entry : graphDraft.scriptFileContents().entrySet()) {
            Path scriptFile = resolveRepoFile(repoPath, entry.getKey());
            Files.createDirectories(scriptFile.getParent());
            Files.writeString(scriptFile, entry.getValue(), StandardCharsets.UTF_8);
        }
        for (Map.Entry<String, TransferConfig> entry : graphDraft.transferConfigs().entrySet()) {
            transferConfigFileService.write(repoPath, groupId, flowPath, entry.getKey(), entry.getValue());
        }
        List<String> activeTransferPaths = graphDraft.nodes().stream()
                .filter(node -> "TRANSFER".equalsIgnoreCase(node.kind()))
                .map(OfflineFlowNode::transferConfigPath)
                .toList();
        transferConfigFileService.deleteStaleForFlow(repoPath, flowPath, activeTransferPaths);
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
}
