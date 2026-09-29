package io.wbdata.kestra.core;

/** 上一期终态非 SUCCESS 且失败策略为 PAUSE：本期不启动业务，需人工恢复上一期后再拉起。 */
public class GatePausedException extends RuntimeException {

    public GatePausedException(String message) {
        super(message);
    }
}
