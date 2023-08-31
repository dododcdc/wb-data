import Editor, { DiffEditor, useMonaco, loader } from '@monaco-editor/react';
import React, {useEffect, useRef, useState} from "react";
import {Button, Table} from "antd";
import {Select} from "antd/lib";
import * as wbsource from "../../service/wbsource";

import { execQuery } from '../../service/other/index';

function ED() {


    const editorRef = useRef(null);

    const [options,setOptions] = useState<Option[]>([])

    const [data,setData] = useState<any>()

    const [columns,setColumns] = useState()



    const handleEditorDidMount = (editor, monaco) => {
        // 在编辑器加载完成后的回调函数
        editorRef.current = editor;
    };

    const handleGetSelectedText = () => {
        if (editorRef.current) {
            const selectedText = editorRef.current.getModel().getValueInRange(editorRef.current.getSelection());
            execQuery({'dbId':db,'sql':selectedText}).then((x) => {


                setData(x)
               const dydol =  Object.keys(x[0]).map(col => {
                    return {
                        title:col
                        ,dataIndex:col
                        ,key: col
                    }
                })

                setColumns(dydol)
            })




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
                placeholder="选择一个数据源"
                optionFilterProp="label"
                onChange={handleChange}
                filterOption={(input, option) =>
                    (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                }
                options={options}
            />

            <Editor height="50vh" theme="vs-dark" defaultLanguage="sql" defaultValue=""
                    onMount={handleEditorDidMount}
            />



            <div>

                <Table dataSource={data} columns={columns} />

            </div>


        </div>
    )

}

export default ED