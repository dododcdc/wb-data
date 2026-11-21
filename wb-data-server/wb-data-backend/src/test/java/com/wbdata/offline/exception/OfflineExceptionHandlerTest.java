package com.wbdata.offline.exception;

import com.wbdata.common.GlobalExceptionHandler;
import com.wbdata.offline.repo.dto.DirtyWorkingTreeResponse;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class OfflineExceptionHandlerTest {

    @Test
    void dirtyWorkingTreeException_returnsStructuredConflictBody() {
        OfflineExceptionHandler handler = new OfflineExceptionHandler();
        DirtyWorkingTreeResponse details = new DirtyWorkingTreeResponse(
                List.of("_flows/example/flow.yaml"),
                List.of("_flows/example/flow.yaml", "README.md"),
                1
        );

        var response = handler.handleDirtyWorkingTreeException(new DirtyWorkingTreeException(details));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(response.getBody()).isNotNull();
        assertThat(response.getBody().getCode()).isEqualTo(HttpStatus.CONFLICT.value());
        assertThat(response.getBody().getMessage()).isEqualTo("工作区有未提交改动");
        assertThat(response.getBody().getData()).isEqualTo(details);
    }

    @Test
    void dirtyWorkingTreeException_takesPrecedenceOverGlobalExceptionHandler() throws Exception {
        MockMvc mockMvc = MockMvcBuilders.standaloneSetup(new DummyController())
                // Deliberately register GlobalExceptionHandler first to match default bean name order.
                .setControllerAdvice(new GlobalExceptionHandler(), new OfflineExceptionHandler())
                .build();

        mockMvc.perform(get("/test/dirty-working-tree"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value(409))
                .andExpect(jsonPath("$.message").value("工作区有未提交改动"))
                .andExpect(jsonPath("$.data.changedFlows[0]").value("_flows/example/flow.yaml"))
                .andExpect(jsonPath("$.data.changedFiles.length()").value(2))
                .andExpect(jsonPath("$.data.otherFileCount").value(1));
    }

    @RestController
    private static class DummyController {
        @GetMapping("/test/dirty-working-tree")
        void throwDirty() {
            throw new DirtyWorkingTreeException(new DirtyWorkingTreeResponse(
                    List.of("_flows/example/flow.yaml"),
                    List.of("_flows/example/flow.yaml", "README.md"),
                    1
            ));
        }
    }
}
