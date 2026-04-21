package com.wbdata.offline.service;

public interface KestraClient {

    void upsertFlow(String source);

    void upsertNamespaceFile(String namespace, String path, String content);

    KestraExecutionSnapshot createExecution(String namespace, String flowId);

    java.util.List<KestraExecutionSnapshot> searchExecutions(java.util.Map<String, String> filters);

    String getFlowSource(String namespace, String flowId);

    KestraExecutionSnapshot getExecution(String executionId);

    java.util.List<KestraLogEntry> getLogs(String executionId, String taskId);

    void killExecution(String executionId);

    boolean supportsTaskType(String taskType);
}
