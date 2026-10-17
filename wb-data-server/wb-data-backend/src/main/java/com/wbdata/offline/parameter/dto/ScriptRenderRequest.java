package com.wbdata.offline.parameter.dto;

import java.util.Map;

public record ScriptRenderRequest(String kind, String script, Map<String, String> parameters) {
}
