import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react';

import { MAX_TRANSFER_SQL_STATEMENTS } from './transferTypes';

export function SqlStatements({
    label,
    statements = [],
    help,
    onChange,
}: {
    label: string;
    statements?: string[];
    help: string;
    onChange: (statements: string[]) => void;
}) {
    const id = useId();
    const [expanded, setExpanded] = useState(false);
    const inputsRef = useRef<Array<HTMLTextAreaElement | null>>([]);
    const addButtonRef = useRef<HTMLButtonElement>(null);
    const focusIndexRef = useRef<number | null>(null);
    const overLimit = statements.length > MAX_TRANSFER_SQL_STATEMENTS;
    const hasEmpty = statements.some((sql) => !sql.trim());

    useEffect(() => {
        const index = focusIndexRef.current;
        if (index === null) return;
        if (index < 0) addButtonRef.current?.focus();
        else inputsRef.current[index]?.focus();
        focusIndexRef.current = null;
    }, [statements]);

    return (
        <div className="transfer-node-sql-group">
            <button
                type="button"
                className="transfer-node-sql-toggle"
                aria-expanded={expanded}
                aria-controls={`${id}-content`}
                onClick={() => setExpanded((current) => !current)}
            >
                {expanded ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
                <span>{label}</span>
                <span className="transfer-node-sql-count">{statements.length}/{MAX_TRANSFER_SQL_STATEMENTS}</span>
                {(overLimit || hasEmpty) && (
                    <span className="transfer-node-filter-error">{overLimit ? '超出上限，请删除多余项' : '有空项，请填写或删除'}</span>
                )}
            </button>
            <div id={`${id}-content`} className="transfer-node-sql-content" hidden={!expanded}>
                <p id={`${id}-help`} className="transfer-node-field-help">{help}</p>
                {statements.map((sql, index) => {
                    const invalid = !sql.trim();
                    const inputId = `${id}-${index}`;
                    return (
                        <div className="transfer-node-field transfer-node-sql-item" key={index}>
                            <div className="transfer-node-sql-item-heading">
                                <label htmlFor={inputId}>{label} 第 {index + 1} 条</label>
                                <button
                                    type="button"
                                    className="transfer-node-sql-action"
                                    aria-label={`删除${label}第 ${index + 1} 条`}
                                    onClick={() => {
                                        focusIndexRef.current = Math.min(index, statements.length - 2);
                                        onChange(statements.filter((_, itemIndex) => itemIndex !== index));
                                    }}
                                >
                                    <Trash2 size={14} aria-hidden="true" />
                                    删除
                                </button>
                            </div>
                            <textarea
                                id={inputId}
                                ref={(element) => { inputsRef.current[index] = element; }}
                                rows={3}
                                value={sql}
                                spellCheck={false}
                                aria-invalid={invalid}
                                aria-describedby={`${id}-help${invalid ? ` ${inputId}-error` : ''}`}
                                onChange={(event) => onChange(statements.map(
                                    (statement, itemIndex) => itemIndex === index ? event.target.value : statement,
                                ))}
                            />
                            {invalid && (
                                <span id={`${inputId}-error`} className="transfer-node-filter-error">请输入 SQL 或删除此项</span>
                            )}
                        </div>
                    );
                })}
                <button
                    ref={addButtonRef}
                    type="button"
                    className="transfer-node-sql-action"
                    disabled={statements.length >= MAX_TRANSFER_SQL_STATEMENTS}
                    onClick={() => {
                        focusIndexRef.current = statements.length;
                        onChange([...statements, '']);
                    }}
                >
                    <Plus size={14} aria-hidden="true" />
                    添加{label}
                </button>
            </div>
        </div>
    );
}
