package com.wbdata.datasource.plugin;

import com.wbdata.plugin.api.DataSourcePlugin;
import com.wbdata.plugin.api.DataSourcePluginDescriptor;
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

@Component
public class DataSourcePluginRegistry {

    private static final Logger log = LoggerFactory.getLogger(DataSourcePluginRegistry.class);

    private final PluginProperties pluginProperties;
    private final Map<String, DataSourcePlugin> plugins = new LinkedHashMap<>();
    private final List<URLClassLoader> classLoaders = new ArrayList<>();

    public DataSourcePluginRegistry(PluginProperties pluginProperties) {
        this.pluginProperties = pluginProperties;
    }

    @PostConstruct
    public synchronized void loadPlugins() {
        plugins.clear();
        closeLoaders();
        classLoaders.clear();

        Path pluginDirectory = Paths.get(pluginProperties.getDir()).normalize().toAbsolutePath();
        if (!Files.exists(pluginDirectory)) {
            log.warn("Plugin directory does not exist: {}", pluginDirectory);
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
            throw new IllegalStateException("Failed to read plugin directory: " + pluginDirectory, exception);
        }

        log.info("Loaded {} datasource plugins from {}", plugins.size(), pluginDirectory);
    }

    public Optional<DataSourcePlugin> getPlugin(String type) {
        if (type == null || type.isBlank()) {
            return Optional.empty();
        }

        return Optional.ofNullable(plugins.get(type.toUpperCase(Locale.ROOT)));
    }

    public List<DataSourcePluginDescriptor> getDescriptors() {
        return plugins.values().stream()
                .map(DataSourcePlugin::descriptor)
                .sorted(Comparator
                        .comparingInt(DataSourcePluginDescriptor::order)
                        .thenComparing(DataSourcePluginDescriptor::label))
                .toList();
    }

    public boolean supports(String type) {
        return getPlugin(type).isPresent();
    }

    @PreDestroy
    public void closeLoaders() {
        for (URLClassLoader classLoader : classLoaders) {
            try {
                classLoader.close();
            } catch (IOException exception) {
                log.debug("Failed to close plugin class loader", exception);
            }
        }
    }

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
                log.warn("No datasource plugin implementation found in {}", pluginJar.getFileName());
            }
        } catch (Exception exception) {
            throw new IllegalStateException("Failed to load plugin jar: " + pluginJar, exception);
        }
    }

    private void registerPlugin(Path pluginJar, DataSourcePlugin plugin) {
        DataSourcePluginDescriptor descriptor = plugin.descriptor();
        if (descriptor == null || descriptor.type() == null || descriptor.type().isBlank()) {
            throw new IllegalStateException("Plugin descriptor type must not be blank: " + pluginJar);
        }

        String type = descriptor.type().toUpperCase(Locale.ROOT);
        if (plugins.containsKey(type)) {
            throw new IllegalStateException("Duplicate datasource plugin type " + type + " from " + pluginJar);
        }

        plugins.put(type, plugin);
        log.info("Registered datasource plugin [{}] from {}", type, pluginJar.getFileName());
    }
}
