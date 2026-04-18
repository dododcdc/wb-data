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

import java.util.Map;

@Component("githubProvider")
public class GitHubRemoteProvider implements GitRemoteProvider {

    private final ObjectMapper objectMapper;
    private final RestTemplate restTemplate;

    public GitHubRemoteProvider(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
        this.restTemplate = new RestTemplate();
    }

    private String username;
    private String token;
    private String baseUrl = "https://github.com";

    public void init(String username, String token, String baseUrl) {
        this.username = username;
        this.token = token;
        if (baseUrl != null && !baseUrl.isBlank()) {
            this.baseUrl = baseUrl;
        }
    }

    @Override
    public String provider() {
        return "github";
    }

    @Override
    public void validateToken() {
        try {
            String url = "https://api.github.com/user";
            restTemplate.getForObject(url, String.class);
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
            String url = "https://api.github.com/user";
            String json = restTemplate.getForObject(url, String.class);
            JsonNode node = objectMapper.readTree(json);
            return node.get("login").asText();
        } catch (Exception ex) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "获取 GitHub 用户信息失败", ex);
        }
    }

    @Override
    public boolean repositoryExists(String repoName) {
        try {
            String url = "https://api.github.com/repos/" + username + "/" + repoName;
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
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.set(HttpHeaders.ACCEPT, MediaType.APPLICATION_JSON_VALUE);
        headers.set(HttpHeaders.AUTHORIZATION, "Bearer " + token);

        Map<String, Object> body = Map.of(
                "name", repoName,
                "private", isPrivate,
                "description", "wb-data offline repo"
        );

        try {
            String url = "https://api.github.com/user/repos";
            restTemplate.postForEntity(url, new org.springframework.http.HttpEntity<>(body, headers), String.class);
        } catch (HttpClientErrorException ex) {
            if (ex.getStatusCode() == HttpStatus.UNPROCESSABLE_ENTITY) {
                // 仓库已存在，忽略
                return;
            }
            if (ex.getStatusCode() == HttpStatus.NOT_FOUND) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                        "无法创建仓库，请检查 Token 权限");
            }
            if (ex.getStatusCode() == HttpStatus.FORBIDDEN) {
                throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Token 权限不足");
            }
            throw ex;
        }
    }

    @Override
    public String buildDisplayUrl(String repoName) {
        return baseUrl + "/" + username + "/" + repoName + ".git";
    }

    @Override
    public String buildPushUrl(String repoName) {
        return "https://" + username + ":" + token + "@github.com/" + username + "/" + repoName + ".git";
    }
}
