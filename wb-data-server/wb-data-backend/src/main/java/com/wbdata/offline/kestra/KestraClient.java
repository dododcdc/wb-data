package com.wbdata.offline.kestra;

public interface KestraClient {

    void upsertFlow(String source);

    void deleteFlow(String namespace, String flowId);

    java.util.List<String> validateFlow(String source);

    void upsertNamespaceFile(String namespace, String path, String content);

    default KestraExecutionSnapshot createExecution(String namespace, String flowId) {
        return createExecution(namespace, flowId, java.util.Map.of());
    }

    default KestraExecutionSnapshot createExecution(String namespace,
                                                     String flowId,
                                                     java.util.Map<String, String> inputs) {
        return createExecution(namespace, flowId, inputs, java.util.Map.of());
    }

    KestraExecutionSnapshot createExecution(String namespace,
                                             String flowId,
                                             java.util.Map<String, String> inputs,
                                             java.util.Map<String, String> labels);

    java.util.List<KestraExecutionSnapshot> searchExecutions(java.util.Map<String, String> filters);

    default KestraExecutionPage searchExecutionsPage(java.util.Map<String, String> filters,
                                                     int page,
                                                     int size,
                                                     String sort) {
        throw new UnsupportedOperationException("searchExecutionsPage not implemented");
    }

    String getFlowSource(String namespace, String flowId);

    KestraExecutionSnapshot getExecution(String executionId);

    java.util.List<KestraLogEntry> getLogs(String executionId, String taskId);

    void killExecution(String executionId);

    default void setExecutionLabels(String executionId, java.util.Map<String, String> labels) {
        throw new UnsupportedOperationException("setExecutionLabels not implemented");
    }

    default void changeExecutionStatus(String executionId, String status) {
        throw new UnsupportedOperationException("changeExecutionStatus not implemented");
    }

    boolean supportsTaskType(String taskType);
}
