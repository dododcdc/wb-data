# 拆分 OfflineFlowDocumentService

目标：把保存/打开任务文档的编排留在原类，把两块已经能独立理解的实现挪走。HTTP 接口、Git 提交用的关联文件列表、调试编译入口都不改。

## 不拆什么

这些已经有自己的类，这次不动：

- `OfflineFlowYamlSupport`：YAML 解析与编译
- `FlowParameterSnapshotStore`：`.parameters.json` 读写
- `FlowParameterCompiler`：SQL 命名参数编译进 Kestra inputs
- `TransferConfigFileService`：传输 sidecar 读写

也不拆 `GitCommandService`、`KestraHttpClient`，不改 `/document`、`/debug/document` 的请求响应形状。

## 现有对外接口（保持）

`OfflineFlowDocumentService` 仍是调用方唯一入口，并继续在方法里加 `RepoLockManager` 锁：

| 方法 | 调用方 |
|---|---|
| `getFlowDocument` | `OfflineFlowController` |
| `saveFlowDocument` | `OfflineFlowController` |
| `compileFlowDraft` | `OfflineExecutionController` |
| `resolveManagedFiles` | `GitCommandService` |
| `CompiledFlowDraft` | 调试执行把 YAML 和 namespace 文件交给 Kestra |

抽出去的类**自己不加锁**。锁只留在上面四个方法。

## 抽出两个类

都放在 `com.wbdata.offline.service`，Spring `@Component`，不新建包、不引入接口。

### 1. `FlowParameterBindingAssembler`

从文档服务挪走参数组绑定相关实现（约 671–920 行）：

- 保存时根据 `parameterBinding` / `parameterBindings` 生成或删除快照
- 读取时把快照和当前参数组比对成 CURRENT / OUTDATED / ARCHIVED / MISSING
- 定义列表按参数组顺序合并，后者不覆盖已有键

文档服务保存前问它「这次要不要写快照」，读取后问它「绑定状态是什么」。

### 2. `FlowGraphDraftBuilder`

从文档服务挪走画布节点草稿组装（约 330–399 行）：

- 把 stages/edges 收成节点、边、脚本内容、传输配置、数据源 map
- 把脚本和传输 sidecar 写回仓库，并删掉已移除传输节点的 sidecar

YAML 怎么编译仍由文档服务调用 `OfflineFlowYamlSupport`。这个类只负责「节点文件在磁盘上长什么样」。

## 仍留在文档服务里的

- `saveFlowDocumentUnlocked` 的步骤顺序：时区 → 参数快照 → 图/旧版保存 → 调度 → Kestra 同步文件 → layout
- `readSnapshot`：把 YAML、脚本、传输文件、参数快照、layout 合成一份任务文档
- 运行时区「创建后不能改」
- 旧版 `saveWithStages`（只改已有节点内容；没有独立入口，不单独建类）

拆完后文档服务应主要是编排，大约从 977 行降到 550 行左右。

## 怎么拆

一次只挪一类，每步都跑现有测试，不先写新测试——行为已经由 `OfflineFlowDocumentServiceTest` 覆盖。

1. 抽出 `FlowParameterBindingAssembler`，文档服务改为委托。跑 `OfflineFlowDocumentServiceTest`。
2. 抽出 `FlowGraphDraftBuilder`，`saveWithGraph` / `compileFlowDraft` / 旧版带参数重编译改为用它。再跑同一组测试。
3. 顺手修上次文案替换留下的空格：`参数快照缺少 任务运行时区`、Swagger 里 `任务 内容读写`。

验证：

```bash
cd wb-data-server/wb-data-backend
mvn -Dtest=OfflineFlowDocumentServiceTest,OfflineFlowControllerTest,OfflineExecutionControllerGroupScopeTest,GitCommandServiceTest test
```

## 明确不做

- 不把 `readSnapshot` 再拆成 Reader（它就是 get/save/compile 的读模型，拆了会把编排打散）
- 不删旧版 stage 保存路径
- 不把测试改去测内部类；测试面仍是 `getFlowDocument` / `saveFlowDocument` / `compileFlowDraft` / `resolveManagedFiles`
