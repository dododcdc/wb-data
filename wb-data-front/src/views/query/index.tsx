import Editor, { DiffEditor, useMonaco, loader } from '@monaco-editor/react';
import React, {useEffect, useRef, useState} from "react";
import {Button} from "antd";
import {Select} from "antd/lib";
import * as wbsource from "../../service/wbsource";

function ED() {


    const editorRef = useRef(null);

    const [options,setOptions] = useState<Option[]>([])



    const handleEditorDidMount = (editor, monaco) => {
        // 在编辑器加载完成后的回调函数
        editorRef.current = editor;
    };

    const handleGetSelectedText = () => {
        if (editorRef.current) {
            const selectedText = editorRef.current.getModel().getValueInRange(editorRef.current.getSelection());
            alert(selectedText);
            alert(db);
        }
    };



    useEffect(() => {

        wbsource.findAll().then(x=>{
            const newarray = x.map(item => ({label:item.name,value:item.id}))
            setOptions(newarray)
        })

    },[])



    const [db,setDb] = useState<number>()
    const handleChange = (value) => {
        setDb(value);

    };




    return (
        <div>

            <Button onClick={handleGetSelectedText}>运行</Button>


            <Select
                showSearch
                placeholder="Select a dataSource"
                optionFilterProp="label"
                onChange={handleChange}
                filterOption={(input, option) =>
                    (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                }
                options={options}
            />

            <Editor height="90vh" theme="vs-dark" defaultLanguage="sql" defaultValue=""
                    onMount={handleEditorDidMount}
            />



            <div>查询结果展示</div>
        </div>
    )

}

export default ED