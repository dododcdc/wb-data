package io.wbdata.kestra.core;

/** 等待前置任务超过一个自身周期仍未就绪，本期标记为超时失败（运维中心可「重跑该期」拉起）。 */
public class GateTimeoutException extends RuntimeException {

    public GateTimeoutException(String message) {
        super(message);
    }
}
