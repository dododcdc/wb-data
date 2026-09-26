package com.wbdata.offline.service;

import com.wbdata.offline.dto.ScriptRenderRequest;
import com.wbdata.offline.transfer.config.TransferInternalProperties;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Base64;
import java.util.Map;

@Service
@RequiredArgsConstructor
public class ScriptRenderService {
    private final TransferInternalProperties properties;

    public String render(String providedToken, ScriptRenderRequest request) {
        authorize(providedToken);
        if (request == null || request.kind() == null || request.script() == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "脚本渲染请求不完整");
        }
        String script = decodeScript(request.script());
        Map<String, String> parameters = request.parameters() == null ? Map.of() : request.parameters();
        try {
            return switch (request.kind()) {
                case "HIVE_SQL" -> ScriptParameterRenderer.renderHive(script, parameters);
                case "SHELL" -> ScriptParameterRenderer.renderShell(script, parameters);
                default -> throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "不支持的脚本类型: " + request.kind());
            };
        } catch (IllegalArgumentException ex) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, ex.getMessage());
        }
    }

    private String decodeScript(String script) {
        try {
            return new String(Base64.getDecoder().decode(script), StandardCharsets.UTF_8);
        } catch (IllegalArgumentException ex) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "脚本内容不是合法的 Base64");
        }
    }

    private void authorize(String providedToken) {
        String configuredToken = properties.getInternalToken();
        if (configuredToken == null || configuredToken.isBlank() || providedToken == null
                || !MessageDigest.isEqual(
                configuredToken.getBytes(StandardCharsets.UTF_8),
                providedToken.getBytes(StandardCharsets.UTF_8))) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Internal script token is invalid");
        }
    }
}
