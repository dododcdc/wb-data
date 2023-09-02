
import Test from '../../component/Test';

import Editor, { DiffEditor, useMonaco, loader } from '@monaco-editor/react';
import React, {useEffect} from "react";

import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
function Monitoring () {

    useEffect(() => {
        // 注册 SQL 语言
        monaco.languages.register({ id: 'sql' });

        // 配置 SQL 语言
        monaco.languages.setLanguageConfiguration('sql', {
            // 添加适当的语法配置
        });

        // 引入 SQL 相关的语言包
        import('monaco-editor/esm/vs/basic-languages/sql/sql.contribution').then(() => {
            monaco.editor.remeasureFonts();
        });
    }, []);

    return (

        <div> 数据监测 测试

            <Test />

            <Editor height="50vh" theme="vs-dark" defaultLanguage="sql" defaultValue="-- todo"
                    language="sql"
                    options={{
                        suggestOnTriggerCharacters: true,
                        wordBasedSuggestions: true,
                        quickSuggestions: true,
                        minimap: {
                            enabled: false
                        }
                    }}
            />

        </div>
    )
}

export default Monitoring