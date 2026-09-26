package com.wbdata.offline.service;

import com.wbdata.offline.dto.ScriptRenderRequest;
import com.wbdata.offline.transfer.config.TransferInternalProperties;
import com.wbdata.sql.SqlStringLiteral;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ScriptRenderServiceTest {

    @Test
    void rendersHiveScriptFromBase64() {
        TransferInternalProperties properties = new TransferInternalProperties();
        properties.setInternalToken("token");
        String script = Base64.getEncoder().encodeToString(
                "select ^[name] from ^[DWD].orders".getBytes(StandardCharsets.UTF_8));

        String rendered = new ScriptRenderService(properties).render("token",
                new ScriptRenderRequest("HIVE_SQL", script, Map.of("name", "小明", "DWD", "dev_dwd")));

        assertThat(rendered).isEqualTo("select " + SqlStringLiteral.render("HIVE", "小明") + " from `dev_dwd`.orders");
    }

    @Test
    void rejectsInvalidTokenAndBase64() {
        TransferInternalProperties properties = new TransferInternalProperties();
        properties.setInternalToken("token");
        ScriptRenderService service = new ScriptRenderService(properties);

        assertThatThrownBy(() -> service.render("wrong",
                new ScriptRenderRequest("SHELL", Base64.getEncoder().encodeToString("echo ^[name]".getBytes()), Map.of())))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("invalid");
        assertThatThrownBy(() -> service.render("token",
                new ScriptRenderRequest("SHELL", "not base64!!!", Map.of("name", "小明"))))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("Base64");
    }
}
