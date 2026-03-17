package com.wbdata.datasource.plugin;

import com.wbdata.plugin.api.DataSourcePlugin;
import com.wbdata.plugin.api.DataSourcePluginDescriptor;
import com.wbdata.plugin.api.AbstractJdbcDataSourcePlugin;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.net.URL;
import java.net.URLClassLoader;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.ServiceLoader;
import java.util.stream.Stream;

/**
 * 数据源插件注册中心
 * 负责从指定目录加载插件 JAR 包并注册数据源插件
 */
@Component
public class DataSourcePluginRegistry {

    private static final Logger log = LoggerFactory.getLogger(DataSourcePluginRegistry.class);

    private final PluginProperties pluginProperties;
    private final DataSourceConnectionPoolManager poolManager;
    private final Map<String, DataSourcePlugin> plugins = new LinkedHashMap<>();
    private final List<URLClassLoader> classLoaders = new ArrayList<>();

    public DataSourcePluginRegistry(PluginProperties pluginProperties,
                                    DataSourceConnectionPoolManager poolManager) {
        this.pluginProperties = pluginProperties;
        this.poolManager = poolManager;
    }

    /**
     * 加载插件目录下的所有数据源插件
     */
    @PostConstruct
    public synchronized void loadPlugins() {
        plugins.clear();
        closeLoaders();
        classLoaders.clear();

        Path pluginDirectory = resolvePluginDirectory();
        if (!Files.exists(pluginDirectory)) {
            log.warn("插件目录不存在: {}", pluginDirectory);
            return;
        }

        try (Stream<Path> jarStream = Files.list(pluginDirectory)) {
            List<Path> pluginJars = jarStream
                    .filter(path -> path.getFileName().toString().endsWith(".jar"))
                    .sorted()
                    .toList();

            for (Path pluginJar : pluginJars) {
                loadPluginJar(pluginJar);
            }
        } catch (IOException exception) {
            throw new IllegalStateException("读取插件目录失败: " + pluginDirectory, exception);
        }

        log.info("从 {} 加载了 {} 个数据源插件", pluginDirectory, plugins.size());

        // 将池化连接供应器接入所有 AbstractJdbcDataSourcePlugin 实例
        AbstractJdbcDataSourcePlugin.setConnectionSupplier(
                (request, jdbcUrl, driverClassName) -> {
                    com.wbdata.datasource.entity.DataSource ds = new com.wbdata.datasource.entity.DataSource();
                    // 如果有 dataSourceId 则使用它，否则根据连接参数派生一个稳定的键
                    Long poolKey = request.dataSourceId() != null
                            ? request.dataSourceId()
                            : (long) java.util.Objects.hash(
                                    request.host(), request.port(),
                                    request.databaseName(), request.username(), request.type());
                    ds.setId(poolKey);
                    ds.setType(request.type());
                    ds.setHost(request.host());
                    ds.setPort(request.port());
                    ds.setDatabaseName(request.databaseName());
                    ds.setUsername(request.username());
                    ds.setPassword(request.password());
                    return poolManager.getConnection(ds, jdbcUrl, driverClassName);
                }
        );
    }

    /**
     * 解析插件目录的绝对路径。
     *
     * <p>{@code wbdata.plugins.dir} 必须配置为绝对路径，否则启动时抛出异常。</p>
     */
    private Path resolvePluginDirectory() {
        String configured = pluginProperties.getDir();
        if (configured == null || configured.isBlank()) {
            throw new IllegalStateException("未配置插件目录，请设置 wbdata.plugins.dir 为绝对路径");
        }
        Path configuredPath = Paths.get(configured);
        if (!configuredPath.isAbsolute()) {
            throw new IllegalStateException("插件目录必须为绝对路径，当前值: " + configured);
        }
        return configuredPath.normalize();
    }

    /**
     * 根据类型获取对应的数据源插件
     */
    public Optional<DataSourcePlugin> getPlugin(String type) {
        if (type == null || type.isBlank()) {
            return Optional.empty();
        }

        return Optional.ofNullable(plugins.get(type.toUpperCase(Locale.ROOT)));
    }

    /**
     * 获取所有已注册插件的描述信息
     */
    public List<DataSourcePluginDescriptor> getDescriptors() {
        return plugins.values().stream()
                .map(DataSourcePlugin::descriptor)
                .sorted(Comparator
                        .comparingInt(DataSourcePluginDescriptor::order)
                        .thenComparing(DataSourcePluginDescriptor::label))
                .toList();
    }

    /**
     * 检查是否支持指定类型的数据源
     */
    public boolean supports(String type) {
        return getPlugin(type).isPresent();
    }

    /**
     * 关闭所有插件的类加载器
     */
    @PreDestroy
    public void closeLoaders() {
        for (URLClassLoader classLoader : classLoaders) {
            try {
                classLoader.close();
            } catch (IOException exception) {
                log.debug("关闭插件类加载器失败", exception);
            }
        }
    }

    /**
     * 加载单个插件 JAR 包
     */
    private void loadPluginJar(Path pluginJar) {
        try {
            URLClassLoader classLoader = new URLClassLoader(
                    new URL[]{pluginJar.toUri().toURL()},
                    DataSourcePlugin.class.getClassLoader()
            );

            ServiceLoader<DataSourcePlugin> loader = ServiceLoader.load(DataSourcePlugin.class, classLoader);
            boolean foundPlugin = false;
            for (DataSourcePlugin plugin : loader) {
                registerPlugin(pluginJar, plugin);
                foundPlugin = true;
            }

            if (foundPlugin) {
                classLoaders.add(classLoader);
            } else {
                classLoader.close();
                log.warn("未在 {} 中找到数据源插件实现", pluginJar.getFileName());
            }
        } catch (Exception exception) {
            throw new IllegalStateException("加载插件 JAR 失败: " + pluginJar, exception);
        }
    }

    /**
     * 注册插件到插件映射表中
     */
    private void registerPlugin(Path pluginJar, DataSourcePlugin plugin) {
        DataSourcePluginDescriptor descriptor = plugin.descriptor();
        if (descriptor == null || descriptor.type() == null || descriptor.type().isBlank()) {
            throw new IllegalStateException("插件描述器的类型不能为空: " + pluginJar);
        }

        String type = descriptor.type().toUpperCase(Locale.ROOT);
        if (plugins.containsKey(type)) {
            throw new IllegalStateException("重复的数据源插件类型 " + type + " 来自 " + pluginJar);
        }

        plugins.put(type, plugin);
        log.info("已注册数据源插件 [{}] 来自 {}", type, pluginJar.getFileName());
    }
}
