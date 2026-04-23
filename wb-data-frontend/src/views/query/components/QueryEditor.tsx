import type * as Monaco from 'monaco-editor';
import { SqlEditor } from '../../../components/sql-editor/SqlEditor';
import '../../core/RouteSkeletons.css';

export interface QueryEditorProps {
    sql: string;
    setSql: (val: string) => void;
    handleEditorDidMount: (editor: Monaco.editor.IStandaloneCodeEditor, monaco: typeof Monaco) => void;
}

/**
 * Query page's SQL editor component.
 * Now a thin wrapper around the shared SqlEditor core.
 * Query-specific features (completion, execution) are registered via handleEditorDidMount.
 */
export function QueryEditor({ sql, setSql, handleEditorDidMount }: QueryEditorProps) {
    return (
        <section className="editor-section h-full w-full relative">
            <div className="editor-wrapper h-full w-full absolute inset-0">
                <SqlEditor
                    value={sql}
                    onChange={(value: string) => setSql(value)}
                    onMount={handleEditorDidMount}
                    options={{
                        padding: { top: 12, bottom: 12 },
                    }}
                />
            </div>
        </section>
    );
}
