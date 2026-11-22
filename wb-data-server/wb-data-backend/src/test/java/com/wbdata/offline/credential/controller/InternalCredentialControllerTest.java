package com.wbdata.offline.credential.controller;

import com.wbdata.offline.credential.dto.DataSourceCredentialRequest;
import com.wbdata.offline.credential.dto.DataSourceCredentialResponse;
import com.wbdata.offline.credential.dto.GitCredentialRequest;
import com.wbdata.offline.credential.dto.GitCredentialResponse;
import com.wbdata.offline.credential.service.InternalCredentialService;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.server.ResponseStatusException;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class InternalCredentialControllerTest {

    @Test
    void resolveDataSource_forwardsTokenAndReturnsJson() throws Exception {
        InternalCredentialService service = mock(InternalCredentialService.class);
        DataSourceCredentialRequest request = new DataSourceCredentialRequest(4L, 11L, "MYSQL");
        when(service.resolveDataSource("token-1", request)).thenReturn(new DataSourceCredentialResponse(
                11L, "MYSQL", "jdbc:mysql://omarchy.local:3306/warehouse", "analyst", "p@ss{{1}}"
        ));
        var mvc = MockMvcBuilders.standaloneSetup(new InternalCredentialController(service)).build();

        mvc.perform(post("/api/v1/internal/offline/credentials/datasource")
                        .header(InternalCredentialController.INTERNAL_TOKEN_HEADER, "token-1")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"groupId\":4,\"dataSourceId\":11,\"expectedType\":\"MYSQL\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.dataSourceId").value(11))
                .andExpect(jsonPath("$.type").value("MYSQL"))
                .andExpect(jsonPath("$.url").value("jdbc:mysql://omarchy.local:3306/warehouse"))
                .andExpect(jsonPath("$.username").value("analyst"))
                .andExpect(jsonPath("$.password").value("p@ss{{1}}"));

        verify(service).resolveDataSource("token-1", request);
    }

    @Test
    void resolveGit_forwardsTokenAndReturnsJson() throws Exception {
        InternalCredentialService service = mock(InternalCredentialService.class);
        GitCredentialRequest request = new GitCredentialRequest(4L);
        when(service.resolveGit("token-1", request)).thenReturn(new GitCredentialResponse(
                4L, "github", "https://github.com/alice/wb-data-4.git", "alice", "ghp_secret"
        ));
        var mvc = MockMvcBuilders.standaloneSetup(new InternalCredentialController(service)).build();

        mvc.perform(post("/api/v1/internal/offline/credentials/git")
                        .header(InternalCredentialController.INTERNAL_TOKEN_HEADER, "token-1")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"groupId\":4}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.groupId").value(4))
                .andExpect(jsonPath("$.provider").value("github"))
                .andExpect(jsonPath("$.repositoryUrl").value("https://github.com/alice/wb-data-4.git"))
                .andExpect(jsonPath("$.username").value("alice"))
                .andExpect(jsonPath("$.token").value("ghp_secret"));

        verify(service).resolveGit("token-1", request);
    }

    @Test
    void rejectsInvalidBodiesAndPropagatesUnauthorized() throws Exception {
        InternalCredentialService service = mock(InternalCredentialService.class);
        when(service.resolveGit("bad", new GitCredentialRequest(4L)))
                .thenThrow(new ResponseStatusException(HttpStatus.UNAUTHORIZED, "invalid"));
        var mvc = MockMvcBuilders.standaloneSetup(new InternalCredentialController(service)).build();

        mvc.perform(post("/api/v1/internal/offline/credentials/datasource")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"groupId\":4}"))
                .andExpect(status().isBadRequest());

        mvc.perform(post("/api/v1/internal/offline/credentials/git")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isBadRequest());

        verifyNoInteractions(service);

        mvc.perform(post("/api/v1/internal/offline/credentials/git")
                        .header(InternalCredentialController.INTERNAL_TOKEN_HEADER, "bad")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"groupId\":4}"))
                .andExpect(status().isUnauthorized());
    }
}
