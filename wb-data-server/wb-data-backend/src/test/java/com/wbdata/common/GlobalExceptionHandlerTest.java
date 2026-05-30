package com.wbdata.common;

import com.wbdata.offline.dto.DirtyWorkingTreeResponse;
import com.wbdata.offline.exception.DirtyWorkingTreeException;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class GlobalExceptionHandlerTest {

    @Test
    void dirtyWorkingTreeException_returnsStructuredConflictBody() {
        GlobalExceptionHandler handler = new GlobalExceptionHandler();
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
}
