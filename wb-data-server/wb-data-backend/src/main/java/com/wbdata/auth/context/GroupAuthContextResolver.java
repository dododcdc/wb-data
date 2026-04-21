package com.wbdata.auth.context;

import com.wbdata.auth.dto.AuthContextResponse;
import com.wbdata.auth.service.AuthContextService;
import com.wbdata.auth.service.AuthSession;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.core.MethodParameter;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.bind.support.WebDataBinderFactory;
import org.springframework.web.context.request.NativeWebRequest;
import org.springframework.web.method.support.HandlerMethodArgumentResolver;
import org.springframework.web.method.support.ModelAndViewContainer;
import org.springframework.web.server.ResponseStatusException;

import jakarta.servlet.http.HttpServletRequest;

@Slf4j
@Component
@RequiredArgsConstructor
public class GroupAuthContextResolver implements HandlerMethodArgumentResolver {

    private final AuthContextService authContextService;

    @Override
    public boolean supportsParameter(MethodParameter parameter) {
        return parameter.hasParameterAnnotation(RequireGroupAuth.class) 
            && parameter.getParameterType().equals(AuthContextResponse.class);
    }

    @Override
    public Object resolveArgument(MethodParameter parameter, 
                                  ModelAndViewContainer mavContainer, 
                                  NativeWebRequest webRequest, 
                                  WebDataBinderFactory binderFactory) {
        
        RequireGroupAuth annotation = parameter.getParameterAnnotation(RequireGroupAuth.class);
        if (annotation == null) {
            return null;
        }

        HttpServletRequest request = webRequest.getNativeRequest(HttpServletRequest.class);
        AuthContextResponse context = null;
        
        if (request != null) {
            context = (AuthContextResponse) request.getAttribute(AuthFilter.AUTH_CONTEXT_ATTRIBUTE);
        }

        // Fallback resolution if not pre-resolved by Filter
        if (context == null) {
            log.debug("AuthContextResponse not found in request attributes, performing fallback resolution");
            Long groupId = resolveGroupId(webRequest);
            if (groupId == null) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "缺少必要的 groupId 参数");
            }
            AuthSession session = AuthContext.require();
            context = authContextService.getContext(session, groupId);
        }

        if (context.currentGroup() == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "当前未选中项目组信息");
        }

        String permissionCode = annotation.value().code();
        if (!context.permissions().contains(permissionCode)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "当前项目组下无此操作权限: " + permissionCode);
        }

        return context;
    }

    private Long resolveGroupId(NativeWebRequest webRequest) {
        // 1. Try Query Parameters (covers URL params and form data)
        String groupIdStr = webRequest.getParameter("groupId");
        if (StringUtils.hasText(groupIdStr)) {
            try {
                return Long.parseLong(groupIdStr);
            } catch (NumberFormatException e) {
                return null;
            }
        }

        // 2. Try Path Variables (e.g. /api/groups/{groupId}/...)
        HttpServletRequest request = webRequest.getNativeRequest(HttpServletRequest.class);
        if (request != null) {
            Object pathVars = request.getAttribute(org.springframework.web.servlet.HandlerMapping.URI_TEMPLATE_VARIABLES_ATTRIBUTE);
            if (pathVars instanceof java.util.Map) {
                Object val = ((java.util.Map<?, ?>) pathVars).get("groupId");
                if (val != null) {
                    try {
                        return Long.parseLong(val.toString());
                    } catch (NumberFormatException e) {
                        // ignore
                    }
                }
            }
        }

        return null;
    }
}
