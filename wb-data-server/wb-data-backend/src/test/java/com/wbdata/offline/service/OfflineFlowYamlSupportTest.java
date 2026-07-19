package com.wbdata.offline.service;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class OfflineFlowYamlSupportTest {

    @Test
    void compileAndParseGraph_roundTripsTransferMetadataAndNamespaceSidecar() {
        OfflineFlowYamlSupport support = new OfflineFlowYamlSupport();
        String transferPath = "transfers/orders/transfer_1.transfer.json";

        String yaml = support.compileGraph(
                support.buildEmptyFlowYaml("orders", "pg-1"),
                List.of(new OfflineFlowYamlSupport.FlowNode(
                        "transfer_1", "TRANSFER", null, null, null, transferPath
                )),
                List.of(),
                Map.of()
        );

        OfflineFlowYamlSupport.FlowNode node = support.parseDocument(yaml)
                .stages().getFirst().nodes().getFirst();

        assertThat(node.kind()).isEqualTo("TRANSFER");
        assertThat(node.scriptPath()).isNull();
        assertThat(node.transferConfigPath()).isEqualTo(transferPath);
        assertThat(support.collectNamespaceFiles(yaml)).containsExactly(transferPath);
    }
}
