import { describe, expect, it } from 'vitest';
import { formatSqlContent, moveCommasToLeading } from './sqlFormatting';

describe('formatSqlContent', () => {
    it('formats simple SELECT statement', () => {
        const input = 'select id, name from users where active = true';
        const result = formatSqlContent(input);
        
        expect(result).toContain('SELECT');
        expect(result).toContain('FROM');
        expect(result).toContain('WHERE');
    });

    it('returns original SQL when formatting throws', () => {
        const malformed = 'SELE CT FRUM';
        const result = formatSqlContent(malformed);
        
        expect(result).toBe(malformed);
    });

    it('formats complex query with joins', () => {
        const input = 'select u.id, u.name, o.total from users u join orders o on u.id = o.user_id where o.total > 100';
        const result = formatSqlContent(input);
        
        expect(result).toContain('SELECT');
        expect(result).toContain('JOIN');
        expect(result).toContain('ON');
    });

    it('preserves empty string', () => {
        expect(formatSqlContent('')).toBe('');
    });

    it('handles whitespace-only input', () => {
        const input = '   \n\t  ';
        const result = formatSqlContent(input);
        
        expect(result).toBe(input);
    });

    it('formats HiveSQL with leading commas while keeping inline function commas intact', () => {
        const input = 'select a, b, coalesce(x, y, 0) as z, count(*) over (partition by p, q order by r) as cnt from dwd.orders where dt = \'^[bizdate]\' and status in (1, 2, 3) group by a, b, coalesce(x, y, 0) order by cnt desc, a asc;';
        const result = formatSqlContent(input, { language: 'hive', commaPosition: 'before' });

        expect(result).toBe([
            'SELECT',
            '  a',
            '  , b',
            '  , coalesce(x, y, 0) AS z',
            '  , count(*) OVER (',
            '    PARTITION BY',
            '      p',
            '      , q',
            '    ORDER BY',
            '      r',
            '  ) AS cnt',
            'FROM',
            '  dwd.orders',
            'WHERE',
            "  dt = '^[bizdate]'",
            '  AND status IN (1, 2, 3)',
            'GROUP BY',
            '  a',
            '  , b',
            '  , coalesce(x, y, 0)',
            'ORDER BY',
            '  cnt DESC',
            '  , a ASC;',
        ].join('\n'));
        // Formatting must remain idempotent on already leading-comma HiveSQL
        expect(formatSqlContent(result, { language: 'hive', commaPosition: 'before' })).toBe(result);
    });

    it('preserves task placeholders, Hive variables, multiline strings, backtick identifiers, and comments', () => {
        const input = [
            'select',
            '  ^[col_name], -- selected col',
            '  -- section 2',
            '  ${hivevar:env_tag},',
            '  "hello,\nworld",',
            '  `col,name`',
            'from tbl',
            'limit ^[row_limit];',
        ].join('\n');

        const result = formatSqlContent(input, { language: 'hive', commaPosition: 'before' });

        expect(result).toContain('  ^[col_name] -- selected col\n  -- section 2\n  , ${hivevar:env_tag}');
        expect(result).toContain('"hello,\nworld"\n  , `col,name`');
        expect(result).toContain('LIMIT\n  ^[row_limit];');
        expect(formatSqlContent(result, { language: 'hive', commaPosition: 'before' })).toBe(result);
    });

    it('does not move an invalid trailing comma onto clause boundaries', () => {
        const malformedCommaBeforeFrom = 'SELECT\n  a,\nFROM\n  tbl;';
        expect(moveCommasToLeading(malformedCommaBeforeFrom)).toBe(malformedCommaBeforeFrom);
    });
});
