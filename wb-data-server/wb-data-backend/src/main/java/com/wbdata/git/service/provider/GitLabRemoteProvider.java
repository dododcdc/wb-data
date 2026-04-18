package com.wbdata.git.service.provider;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.server.ResponseStatusException;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Map;

@Component("gitlabProvider")
public class GitLabRemoteProvider implements GitRemoteProvider {

    private final ObjectMapper objectMapper;
    private final RestTemplate restTemplate;

    public GitLabRemoteProvider(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
        this.restTemplate = new RestTemplate();
    }

    private String username;
    private String token;
    private String baseUrl;

    public void init(String username, String token, String baseUrl) {
        this.username = username;
        this.token = token;
        this.baseUrl = baseUrl;
    }

    @Override
    public String provider() {
        return "gitlab";
    }

    private String apiBase() {
        return baseUrl.replaceFirst("/$", "") + "/api/v4";
    }

    private HttpHeaders authHeaders() {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.set(HttpHeaders.AUTHORIZATION, "Bearer " + token);
        return headers;
    }

    @Override
    public void validateToken() {
        try {
            String url = apiBase() + "/user";
            restTemplate.getForEntity(url, String.class);
        } catch (HttpClientErrorException ex) {
            if (ex.getStatusCode() == HttpStatus.UNAUTHORIZED) {
                throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Token 无效");
            }
            throw ex;
        }
    }

    @Override
    public String getUsername() {
        if (username != null) {
            return username;
        }
        try {
            String json = restTemplate.getForObject(apiBase() + "/user", String.class);
            JsonNode node = objectMapper.readTree(json);
            return node.get("username").asText();
        } catch (Exception ex) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "获取 GitLab 用户信息失败", ex);
        }
    }

    @Override
    public boolean repositoryExists(String repoName) {
        try {
            String encodedUsername = URLEncoder.encode(username, StandardCharsets.UTF_8);
            String url = apiBase() + "/projects/" + encodedUsername + "%2F" + repoName;
            restTemplate.getForObject(url, String.class);
            return true;
        } catch (HttpClientErrorException ex) {
            if (ex.getStatusCode() == HttpStatus.NOT_FOUND) {
                return false;
            }
            return false;
        }
    }

    @Override
    public void createRepository(String repoName, boolean isPrivate) {
        String encodedUsername = URLEncoder.encode(username, StandardCharsets.UTF_8);
        String url = apiBase() + "/projects/" + encodedUsername;

        Map<String, Object> body = Map.of(
                "name", repoName,
                "visibility", isPrivate ? "private" : "public",
                "description", "wb-data offline repo"
        );

        try {
            restTemplate.postForEntity(url, new org.springframework.http.HttpEntity<>(body, authHeaders()), String.class);
        } catch (HttpClientErrorException ex) {
            if (ex.getStatusCode() == HttpStatus.BAD_REQUEST) {
                String bodyStr = ex.getResponseBodyAsString();
                if (bodyStr != null && bodyStr.contains("has already been taken")) {
                    return;
                }
            }
            if (ex.getStatusCode() == HttpStatus.FORBIDDEN) {
                throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Token 权限不足");
            }
            if (ex.getStatusCode() == HttpStatus.NOT_FOUND) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "用户名不存在: " + username);
            }
            throw ex;
        }
    }

    @Override
    public String buildDisplayUrl(String repoName) {
        String base = baseUrl.replaceFirst("/$", "");
        return base + "/" + username + "/" + repoName + ".git";
    }

    @Override
    public String buildPushUrl(String repoName) {
        String base = baseUrl.replaceFirst("/$", "");
        return "https://" + username + ":" + token + "@" + base.replaceFirst("https://", "") + "/" + username + "/" + repoName + ".git";
    }
}
