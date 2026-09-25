package com.wbdata.auth.context;

import com.wbdata.auth.service.GroupAuthorizationService;
import lombok.RequiredArgsConstructor;
import org.springframework.core.MethodParameter;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.bind.support.WebDataBinderFactory;
import org.springframework.web.context.request.NativeWebRequest;
import org.springframework.web.context.request.RequestAttributes;
import org.springframework.web.method.support.HandlerMethodArgumentResolver;
import org.springframework.web.method.support.ModelAndViewContainer;
import org.springframework.web.servlet.HandlerMapping;
import org.springframework.web.server.ResponseStatusException;

import java.util.Map;
import java.util.Objects;

@Component
@RequiredArgsConstructor
public class GroupAuthContextResolver implements HandlerMethodArgumentResolver {
    private final GroupAuthorizationService authorizationService;

    @Override
    public boolean supportsParameter(MethodParameter parameter) {
        return parameter.hasParameterAnnotation(RequireGroupAuth.class)
                && parameter.getParameterType().equals(GroupAuthContext.class);
    }

    @Override
    public Object resolveArgument(MethodParameter parameter, ModelAndViewContainer mavContainer,
                                  NativeWebRequest webRequest, WebDataBinderFactory binderFactory) {
        RequireGroupAuth annotation = Objects.requireNonNull(parameter.getParameterAnnotation(RequireGroupAuth.class));
        return authorizationService.requireGroup(AuthContext.require(), resolveGroupId(webRequest), annotation.value());
    }

    private Long resolveGroupId(NativeWebRequest request) {
        String[] queryValues = request.getParameterValues("groupId");
        if (queryValues != null && queryValues.length != 1) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "groupId 参数只能指定一次");
        }
        Long queryGroupId = queryValues == null ? null : parseGroupId(queryValues[0]);
        Object pathVariables = request.getAttribute(HandlerMapping.URI_TEMPLATE_VARIABLES_ATTRIBUTE,
                RequestAttributes.SCOPE_REQUEST);
        Object pathValue = pathVariables instanceof Map<?, ?> variables ? variables.get("groupId") : null;
        Long pathGroupId = pathValue == null ? null : parseGroupId(pathValue.toString());
        if (pathGroupId != null && queryGroupId != null && !pathGroupId.equals(queryGroupId)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "路径与查询参数中的 groupId 不一致");
        }
        Long groupId = pathGroupId != null ? pathGroupId : queryGroupId;
        if (groupId == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "缺少必要的 groupId 参数");
        }
        return groupId;
    }

    private Long parseGroupId(String value) {
        try {
            long groupId = Long.parseLong(value);
            if (groupId > 0) return groupId;
        } catch (NumberFormatException ignored) {
        }
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "groupId 必须是正整数");
    }
}
