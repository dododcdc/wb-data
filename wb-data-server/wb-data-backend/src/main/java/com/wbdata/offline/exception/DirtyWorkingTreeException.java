package com.wbdata.offline.exception;

import com.wbdata.offline.dto.DirtyWorkingTreeResponse;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

public class DirtyWorkingTreeException extends ResponseStatusException {

    private final DirtyWorkingTreeResponse details;

    public DirtyWorkingTreeException(DirtyWorkingTreeResponse details) {
        super(HttpStatus.CONFLICT, "工作区有未提交改动");
        this.details = details;
    }

    public DirtyWorkingTreeResponse details() {
        return details;
    }
}
