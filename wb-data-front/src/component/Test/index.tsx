import React from 'react';

import httpclient from "../../utils/httpclient.js";
import {Table} from "antd";

const Test:React.FC = () => {

    const dataSource = [
        {

            name: '胡彦斌',
            age: 32,
            address: '西湖区湖底公园1号',
        },
        {

            name: '胡彦祖',
            age: 42,
            address: '西湖区湖底公园1号',
        },
    ];

    const columns = [
        {
            title: '姓名',
            dataIndex: 'name',
            key: 'name',
        },
        {
            title: '年龄',
            dataIndex: 'age',
            key: 'age',
        },
        {
            title: '住址',


        },
    ];

    return (
        <div>
            <Table rowSelection={{
                type:'checkbox'
            }}  dataSource={dataSource} columns={columns} />;
        </div>
    )


}

export default Test;