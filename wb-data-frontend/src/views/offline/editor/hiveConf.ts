export const HIVE_CONF_KEY_PATTERN = /^[a-zA-Z0-9._-]+$/;
export const MAX_HIVE_CONF_KEY_LENGTH = 200;

export interface HiveConfPreset {
    key: string;
    value: string;
    label: string;
    description: string;
}

export const HIVE_CONF_PRESETS: readonly HiveConfPreset[] = [
    {
        key: 'hive.exec.dynamic.partition',
        value: 'true',
        label: '开启动态分区',
        description: '允许 INSERT 语句按分区列动态创建写入分区',
    },
    {
        key: 'hive.exec.dynamic.partition.mode',
        value: 'nonstrict',
        label: '非严格分区模式',
        description: '允许全部分区列均使用动态分区',
    },
    {
        key: 'hive.auto.convert.join',
        value: 'true',
        label: 'MapJoin 自动优化',
        description: '小表自动转换为 Broadcast MapJoin',
    },
    {
        key: 'hive.merge.mapfiles',
        value: 'true',
        label: '合并 Map 小文件',
        description: '仅 Map 任务结束时自动合并过小输出文件',
    },
    {
        key: 'hive.merge.mapredfiles',
        value: 'true',
        label: '合并 MR 小文件',
        description: 'MapReduce 任务结束时自动合并输出小文件',
    },
    {
        key: 'mapreduce.job.queuename',
        value: 'default',
        label: '指定执行队列',
        description: '设置提交到 YARN / MR 的队列名称',
    },
];

export interface HiveConfDiffEntry {
    key: string;
    status: 'ADDED' | 'REMOVED' | 'MODIFIED';
    baseValue: string | null;
    targetValue: string | null;
}

export function validateHiveConfEntry(key: string, value: string): string | null {
    const trimmedKey = key.trim();
    if (!trimmedKey) {
        return '参数名不能为空';
    }
    if (trimmedKey.length > MAX_HIVE_CONF_KEY_LENGTH || !HIVE_CONF_KEY_PATTERN.test(trimmedKey)) {
        return '仅支持字母、数字、点(.)、下划线(_)和短横线(-)';
    }
    if (/[\r\n\0]/.test(value)) {
        return '参数值不能包含换行或空字符';
    }
    return null;
}

export function normalizeHiveConfRecord(
    raw?: Record<string, string> | null,
): Record<string, string> | undefined {
    if (!raw) {
        return undefined;
    }
    const normalized: Record<string, string> = {};
    for (const [rawKey, value] of Object.entries(raw)) {
        const key = rawKey.trim();
        if (!key || value == null) {
            continue;
        }
        normalized[key] = value;
    }
    return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export function cloneHiveConfRecord(
    raw?: Record<string, string> | null,
): Record<string, string> | undefined {
    const normalized = normalizeHiveConfRecord(raw);
    return normalized ? { ...normalized } : undefined;
}

export function areHiveConfsEqual(
    left?: Record<string, string> | null,
    right?: Record<string, string> | null,
): boolean {
    const normLeft = normalizeHiveConfRecord(left);
    const normRight = normalizeHiveConfRecord(right);
    if (!normLeft && !normRight) {
        return true;
    }
    if (!normLeft || !normRight) {
        return false;
    }
    const leftKeys = Object.keys(normLeft);
    const rightKeys = Object.keys(normRight);
    if (leftKeys.length !== rightKeys.length) {
        return false;
    }
    return leftKeys.every((key) => (
        Object.prototype.hasOwnProperty.call(normRight, key)
        && normLeft[key] === normRight[key]
    ));
}

export function serializeHiveConfForSignature(
    raw?: Record<string, string> | null,
): [string, string][] | null {
    const normalized = normalizeHiveConfRecord(raw);
    return normalized ? Object.entries(normalized) : null;
}

export function diffHiveConfEntries(
    baseConf?: Record<string, string> | null,
    targetConf?: Record<string, string> | null,
): HiveConfDiffEntry[] {
    const left = normalizeHiveConfRecord(baseConf) ?? {};
    const right = normalizeHiveConfRecord(targetConf) ?? {};
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    const entries: HiveConfDiffEntry[] = [];
    for (const key of keys) {
        const hasLeft = Object.prototype.hasOwnProperty.call(left, key);
        const hasRight = Object.prototype.hasOwnProperty.call(right, key);
        if (!hasLeft && hasRight) {
            entries.push({ key, status: 'ADDED', baseValue: null, targetValue: right[key] });
        } else if (hasLeft && !hasRight) {
            entries.push({ key, status: 'REMOVED', baseValue: left[key], targetValue: null });
        } else if (hasLeft && hasRight && left[key] !== right[key]) {
            entries.push({ key, status: 'MODIFIED', baseValue: left[key], targetValue: right[key] });
        }
    }
    return entries;
}
