import { describe, expect, it } from 'vitest';
import { formatSqlContent } from './sqlFormatting';

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
});
