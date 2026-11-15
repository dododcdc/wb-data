import { format, type SqlLanguage } from 'sql-formatter';

export type SqlCommaPosition = 'before' | 'after';

export interface SqlFormatOptions {
    language?: SqlLanguage;
    commaPosition?: SqlCommaPosition;
}

type QuoteDelimiter = "'" | '"' | '`';

interface ScannedLine {
    text: string;
    indentLength: number;
    startedInMultilineContext: boolean;
    hasCode: boolean;
    firstCodeSlice: string;
    trailingCommaIndex: number | null;
    isStandaloneComma: boolean;
    removed: boolean;
    prependLeadingComma: boolean;
}

const DISALLOWED_LEADING_COMMA_TARGET = /^(?:[;)\]]|(?:FROM|WHERE|GROUP\s+BY|HAVING|ORDER\s+BY|SORT\s+BY|CLUSTER\s+BY|DISTRIBUTE\s+BY|LIMIT|UNION|EXCEPT|INTERSECT)\b)/i;
const WB_PARAM_CUSTOM_REGEX = String.raw`\^\[[A-Za-z0-9_.-]+\]`;

function scanFormattedLines(lines: string[]): ScannedLine[] {
    let quote: QuoteDelimiter | null = null;
    let inBlockComment = false;

    return lines.map((line) => {
        const startedInMultilineContext = quote !== null || inBlockComment;
        const indentLength = line.search(/\S|$/);
        let hasCode = false;
        let hasNonCommaCode = false;
        let firstCodeIndex = -1;
        let trailingCommaIndex: number | null = null;
        let commaCount = 0;

        for (let i = 0; i < line.length; i += 1) {
            const ch = line[i];
            const next = line[i + 1];

            if (inBlockComment) {
                if (ch === '*' && next === '/') {
                    inBlockComment = false;
                    i += 1;
                }
                continue;
            }

            if (quote !== null) {
                hasCode = true;
                hasNonCommaCode = true;
                if (quote !== '`' && ch === '\\' && i + 1 < line.length) {
                    i += 1;
                    continue;
                }
                if (ch === quote) {
                    if (next === quote) {
                        i += 1;
                    } else {
                        quote = null;
                    }
                }
                continue;
            }

            if (ch === ' ' || ch === '\t') {
                continue;
            }

            if (ch === '-' && next === '-') {
                break;
            }

            if (ch === '/' && next === '*') {
                const closeIndex = line.indexOf('*/', i + 2);
                if (closeIndex === -1) {
                    inBlockComment = true;
                    break;
                }
                i = closeIndex + 1;
                continue;
            }

            hasCode = true;
            if (firstCodeIndex === -1) {
                firstCodeIndex = i;
            }

            if (ch === ',') {
                commaCount += 1;
                trailingCommaIndex = i;
                continue;
            }

            hasNonCommaCode = true;
            trailingCommaIndex = null;

            if (ch === "'" || ch === '"' || ch === '`') {
                quote = ch;
            }
        }

        const isStandaloneComma =
            !startedInMultilineContext
            && !hasNonCommaCode
            && commaCount === 1
            && trailingCommaIndex !== null;

        return {
            text: line,
            indentLength,
            startedInMultilineContext,
            hasCode,
            firstCodeSlice: firstCodeIndex >= 0 ? line.slice(firstCodeIndex) : '',
            trailingCommaIndex,
            isStandaloneComma,
            removed: false,
            prependLeadingComma: false,
        };
    });
}

function removeTrailingCommaFromLine(line: string, commaIndex: number): string {
    const before = line.slice(0, commaIndex);
    const after = line.slice(commaIndex + 1);
    if (!after.trim()) {
        return before.trimEnd();
    }
    const needsSpace = before.length > 0 && !/\s$/.test(before) && !/^\s/.test(after);
    return `${before}${needsSpace ? ' ' : ''}${after}`;
}

function canAcceptLeadingComma(line: ScannedLine): boolean {
    if (!line.hasCode || line.startedInMultilineContext) {
        return false;
    }
    return !DISALLOWED_LEADING_COMMA_TARGET.test(line.firstCodeSlice);
}

/**
 * Converts line-ending trailing commas (and standalone comma lines produced when
 * comments precede commas) into leading commas placed at the start of the next SQL item.
 * Commas inside strings, backticks, comments, and same-line expressions remain unchanged.
 */
export function moveCommasToLeading(sql: string): string {
    const eol = sql.includes('\r\n') ? '\r\n' : '\n';
    const scanned = scanFormattedLines(sql.split(/\r?\n/));

    for (let i = 0; i < scanned.length; i += 1) {
        const current = scanned[i];
        if (current.trailingCommaIndex === null) {
            continue;
        }

        let targetIndex = -1;
        for (let k = i + 1; k < scanned.length; k += 1) {
            const candidate = scanned[k];
            if (!candidate.hasCode) {
                continue;
            }
            if (canAcceptLeadingComma(candidate)) {
                targetIndex = k;
            }
            break;
        }

        if (targetIndex === -1) {
            continue;
        }

        if (current.isStandaloneComma) {
            current.removed = true;
        } else {
            current.text = removeTrailingCommaFromLine(current.text, current.trailingCommaIndex);
        }
        scanned[targetIndex].prependLeadingComma = true;
    }

    return scanned
        .filter((line) => !line.removed)
        .map((line) => {
            if (!line.prependLeadingComma) {
                return line.text;
            }
            const indent = line.text.slice(0, line.indentLength);
            const rest = line.text.slice(line.indentLength);
            return `${indent}, ${rest}`;
        })
        .join(eol);
}

/**
 * Format SQL content using sql-formatter.
 * Returns the original SQL if formatting throws an error.
 */
export function formatSqlContent(rawSql: string, options?: SqlFormatOptions): string {
    if (!rawSql.trim()) {
        return rawSql;
    }

    try {
        const formatted = format(rawSql, {
            language: options?.language ?? 'sql',
            keywordCase: 'upper',
            ...(rawSql.includes('^[')
                ? {
                    paramTypes: {
                        positional: true,
                        custom: [{ regex: WB_PARAM_CUSTOM_REGEX }],
                    },
                }
                : {}),
        });
        return options?.commaPosition === 'before'
            ? moveCommasToLeading(formatted)
            : formatted;
    } catch {
        return rawSql;
    }
}
