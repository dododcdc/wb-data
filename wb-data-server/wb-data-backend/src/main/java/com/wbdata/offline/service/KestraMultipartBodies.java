package com.wbdata.offline.service;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.Map;

/**
 * Kestra multipart 请求体构造：执行 inputs 与命名空间文件上传。
 */
final class KestraMultipartBodies {

    private KestraMultipartBodies() {
    }

    static byte[] executionBody(String boundary, Map<String, String> inputs) {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        try {
            for (Map.Entry<String, String> input : inputs.entrySet()) {
                String key = input.getKey();
                if (key == null || !key.matches("[A-Za-z][A-Za-z0-9_]{0,63}")) {
                    throw new IllegalArgumentException("Kestra input 名称不合法: " + key);
                }
                if (input.getValue() == null) {
                    throw new IllegalArgumentException("Kestra input 不能为空: " + key);
                }
                output.write(("--" + boundary + "\r\n").getBytes(StandardCharsets.UTF_8));
                output.write(("Content-Disposition: form-data; name=\"" + key + "\"\r\n")
                        .getBytes(StandardCharsets.UTF_8));
                output.write("Content-Type: text/plain; charset=UTF-8\r\n\r\n"
                        .getBytes(StandardCharsets.UTF_8));
                output.write(input.getValue().getBytes(StandardCharsets.UTF_8));
                output.write("\r\n".getBytes(StandardCharsets.UTF_8));
            }
            output.write(("--" + boundary + "--\r\n").getBytes(StandardCharsets.UTF_8));
            return output.toByteArray();
        } catch (IOException ex) {
            throw new UncheckedIOException(ex);
        }
    }

    static byte[] fileUploadBody(String boundary, String path, String content) {
        String filename = Path.of(path).getFileName().toString();
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        try {
            output.write(("--" + boundary + "\r\n").getBytes(StandardCharsets.UTF_8));
            output.write(("Content-Disposition: form-data; name=\"fileContent\"; filename=\"" + filename + "\"\r\n")
                    .getBytes(StandardCharsets.UTF_8));
            output.write("Content-Type: application/octet-stream\r\n\r\n".getBytes(StandardCharsets.UTF_8));
            output.write(content.getBytes(StandardCharsets.UTF_8));
            output.write(("\r\n--" + boundary + "--\r\n").getBytes(StandardCharsets.UTF_8));
            return output.toByteArray();
        } catch (IOException ex) {
            throw new UncheckedIOException("构造 Kestra 文件上传请求失败", ex);
        }
    }
}
