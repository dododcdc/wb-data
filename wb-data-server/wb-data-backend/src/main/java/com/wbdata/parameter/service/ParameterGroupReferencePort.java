package com.wbdata.parameter.service;

import com.wbdata.parameter.dto.ParameterGroupReferencesResponse;

/**
 * 参数组被离线任务引用的查询端口（由离线模块提供实现，避免 parameter 包反向依赖 offline 包）。
 */
public interface ParameterGroupReferencePort {

    ParameterGroupReferencesResponse findReferences(Long groupId, String parameterGroupCode);
}
