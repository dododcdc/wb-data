package com.wbdata;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 校验后端业务域顶层包依赖图始终为无环 DAG，并守卫关键单向依赖边界。
 */
class BackendArchitectureTest {

    private static final Pattern IMPORT_PATTERN =
            Pattern.compile("^\\s*import\\s+(?:static\\s+)?com\\.wbdata\\.([a-zA-Z0-9_]+)\\.([^;]+);", Pattern.MULTILINE);

    @Test
    void topLevelDomainsFormAcyclicDagAndRespectLayerBoundaries() throws IOException {
        Path root = resolveMainSourceRoot();
        Map<String, Set<String>> edges = new TreeMap<>();
        Map<String, Map<String, List<String>>> importDetails = new TreeMap<>();

        try (var stream = Files.walk(root)) {
            for (Path file : stream.filter(Files::isRegularFile).filter(p -> p.toString().endsWith(".java")).toList()) {
                Path relative = root.relativize(file);
                if (relative.getNameCount() < 2) {
                    continue;
                }
                String sourceDomain = relative.getName(0).toString();
                edges.computeIfAbsent(sourceDomain, ignored -> new TreeSet<>());
                String content = Files.readString(file);
                Matcher matcher = IMPORT_PATTERN.matcher(content);
                while (matcher.find()) {
                    String targetDomain = matcher.group(1);
                    String importedSymbol = matcher.group(2);
                    if (!targetDomain.equals(sourceDomain)) {
                        edges.computeIfAbsent(sourceDomain, ignored -> new TreeSet<>()).add(targetDomain);
                        edges.computeIfAbsent(targetDomain, ignored -> new TreeSet<>());
                        importDetails
                                .computeIfAbsent(sourceDomain, ignored -> new TreeMap<>())
                                .computeIfAbsent(targetDomain, ignored -> new ArrayList<>())
                                .add(relative.toString().replace('\\', '/') + " -> " + targetDomain + "." + importedSymbol);
                    }
                }
            }
        }

        List<List<String>> cycles = findNonTrivialSccs(edges);
        assertThat(cycles)
                .withFailMessage(() -> formatCycleFailure(cycles, importDetails))
                .isEmpty();

        assertForbiddenDependencies(edges, importDetails, "auth",
                List.of("user", "group", "offline", "git", "datasource", "parameter", "query", "operations", "bootstrap"));
        assertForbiddenDependencies(edges, importDetails, "user",
                List.of("group", "offline", "git", "bootstrap"));
        assertForbiddenDependencies(edges, importDetails, "group",
                List.of("offline", "git", "bootstrap"));
        assertForbiddenDependencies(edges, importDetails, "offline",
                List.of("git", "bootstrap"));
    }

    private static Path resolveMainSourceRoot() {
        Path direct = Path.of("src/main/java/com/wbdata");
        if (Files.isDirectory(direct)) {
            return direct;
        }
        Path fromRepoRoot = Path.of("wb-data-server/wb-data-backend/src/main/java/com/wbdata");
        if (Files.isDirectory(fromRepoRoot)) {
            return fromRepoRoot;
        }
        throw new IllegalStateException("Cannot locate main source root com.wbdata from " + Path.of("").toAbsolutePath());
    }

    private static void assertForbiddenDependencies(Map<String, Set<String>> edges,
                                                    Map<String, Map<String, List<String>>> importDetails,
                                                    String sourceDomain,
                                                    List<String> forbiddenTargets) {
        Set<String> actualTargets = edges.getOrDefault(sourceDomain, Set.of());
        for (String forbidden : forbiddenTargets) {
            assertThat(actualTargets)
                    .withFailMessage(() -> "Forbidden dependency " + sourceDomain + " -> " + forbidden + ": "
                            + importDetails.getOrDefault(sourceDomain, Map.of()).getOrDefault(forbidden, List.of()))
                    .doesNotContain(forbidden);
        }
    }

    private static List<List<String>> findNonTrivialSccs(Map<String, Set<String>> edges) {
        Tarjan tarjan = new Tarjan(edges);
        return tarjan.findSccs().stream()
                .filter(scc -> scc.size() > 1)
                .toList();
    }

    private static String formatCycleFailure(List<List<String>> cycles,
                                             Map<String, Map<String, List<String>>> importDetails) {
        StringBuilder sb = new StringBuilder("Detected domain dependency cycle(s):\n");
        for (List<String> cycle : cycles) {
            sb.append("  SCC: ").append(cycle).append('\n');
            Set<String> members = Set.copyOf(cycle);
            for (String src : cycle) {
                for (Map.Entry<String, List<String>> entry : importDetails.getOrDefault(src, Map.of()).entrySet()) {
                    if (members.contains(entry.getKey())) {
                        for (String detail : entry.getValue()) {
                            sb.append("    ").append(detail).append('\n');
                        }
                    }
                }
            }
        }
        return sb.toString();
    }

    private static final class Tarjan {
        private final Map<String, Set<String>> edges;
        private final Map<String, Integer> indices = new HashMap<>();
        private final Map<String, Integer> lowlink = new HashMap<>();
        private final Deque<String> stack = new ArrayDeque<>();
        private final Set<String> onStack = new HashSet<>();
        private final List<List<String>> sccs = new ArrayList<>();
        private int index = 0;

        private Tarjan(Map<String, Set<String>> edges) {
            this.edges = edges;
        }

        private List<List<String>> findSccs() {
            for (String node : edges.keySet()) {
                if (!indices.containsKey(node)) {
                    strongConnect(node);
                }
            }
            return sccs;
        }

        private void strongConnect(String v) {
            indices.put(v, index);
            lowlink.put(v, index);
            index++;
            stack.push(v);
            onStack.add(v);

            for (String w : edges.getOrDefault(v, Set.of())) {
                if (!indices.containsKey(w)) {
                    strongConnect(w);
                    lowlink.put(v, Math.min(lowlink.get(v), lowlink.get(w)));
                } else if (onStack.contains(w)) {
                    lowlink.put(v, Math.min(lowlink.get(v), indices.get(w)));
                }
            }

            if (lowlink.get(v).equals(indices.get(v))) {
                List<String> scc = new ArrayList<>();
                while (true) {
                    String w = stack.pop();
                    onStack.remove(w);
                    scc.add(w);
                    if (w.equals(v)) {
                        break;
                    }
                }
                sccs.add(scc.stream().sorted().toList());
            }
        }
    }
}
