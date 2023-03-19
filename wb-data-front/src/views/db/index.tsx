
import React, {useEffect, useState} from 'react';


import httpclient from "../../utils/httpclient";
import {get ,post,del} from '../../utils/api';
import * as wbsource from "../../service/wbsource";
import {WbSource} from "../../service/wbsource/types";
import DbAdd from "../../component/DbAdd";

import {  Space,Col, Row,Table,Button,Popconfirm,message } from 'antd';
import {ColumnsType} from "antd/es/table";






const Db:React.FC = () => {


    const columns:ColumnsType<WbSource> = [


        {
            title:"url"
            ,dataIndex: 'url'
            ,key:'url'
        },
        {
            title:"username"
            ,dataIndex:"username"
            ,key:"username"
        },
        {
            title:"password"
            ,dataIndex:"password"
            ,key:"password"
        },
        {
            title:"dbName"
            ,dataIndex:"db_name"
            ,key:"db_name"
        },
        {
            title:"Action"
            ,key:"action"
            , render: (text, record) => (
                <Space size="middle">
                    <Popconfirm
                        title="确定要删除吗?"
                        onConfirm={() => del(record.id)}
                        okText="确定"
                        cancelText="取消"
                    >
                        <Button type="primary" danger> 删除</Button>
                    </Popconfirm>
                </Space>
            )
        }
    ]


    const [data,setData] = useState<WbSource[]|null>(null)

    const getAll = () => {


        wbsource.findAll().then(x => {
            console.log(x)
            setData(x)
        })

    }

    const del = (id:React.Key) => {

        httpclient.delete("/db/del/" + id)
            .then(resp => {

                if (resp.data.code === '200') {

                    //刷新数据
                    getAll();
                    message.info(resp.data.msg)

                }else {

                    message.error(resp.data.msg)

                }

            })

    }

    useEffect(() => {
            getAll()
    },[])

    if (!data) {
        return <div>Loading data...</div>;
    }

    return (
        <div>
            <Row>
                <Col span={2}></Col>
                <Col span={20}>
                    <Space wrap>
                    <DbAdd getAll={getAll} />

                </Space>

                    <Table
                        rowSelection={{
                            type: 'checkbox'
                        }}
                        columns={columns}
                        dataSource={data} rowKey="id"
                    >

                    </Table>
                </Col>
                <Col span={2}></Col>
            </Row>


        </div>
    )

}

export default Db