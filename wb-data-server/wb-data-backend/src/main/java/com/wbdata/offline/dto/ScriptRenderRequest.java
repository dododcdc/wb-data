package com.wbdata.offline.dto;

import java.util.Map;

public record ScriptRenderRequest(String kind, String script, Map<String, String> parameters) {
}
