import React, {useEffect, useState} from 'react';

import {WbRule} from '../../service/wbrule/types';
import {ColumnsType} from "antd/es/table";
import {Button, Col, Popconfirm, Row, Space, Table} from "antd";
import RuleAdd from "../../component/RuleAdd";

import * as wbRule from "../../service/wbrule/index";
import moment from 'moment';


const Rule: React.FC = () => {

    const columns: ColumnsType<WbRule> = [
        {
            title: "规则名称"
            , dataIndex: 'name'
            , key: 'name'
        },
        {
            title: "规则描述"
            , dataIndex: 'desc'
            , key: 'desc'
        },
        {
             title: "规则sql"
            , dataIndex: 'rule'
            , key: 'rule'
        },
        {
            title: "创建时间"
            , dataIndex: 'createTime'
            , key: 'createTime'
            ,render: (text) => moment(text).format('YYYY-MM-DD HH:mm:ss')
        },
        {
            title: "更新时间"
            , dataIndex: 'updateTime'
            , key: 'updateTime'
            ,render: (text) => moment(text).format('YYYY-MM-DD HH:mm:ss')
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

    const [data, setData] = useState<any>([])

    const [pagination, setPagination] = useState<any>({ current: 1, pageSize: 10,total:0 });


    const del = (id:any) => {
        wbRule.del(id).then(x => {
            if (x) { // 删除成功刷新数据
                if (data.length===1){ // 当这页只有一条数据时，删除这条数据后跳转到上页
                    const m = pagination.current-1
                    getPageData(m, pagination.pageSize);
                }

                getPageData(pagination.current, pagination.pageSize);
            }
        })
    }

    const getPageData = (page: any,size:any) => {
        wbRule.page(page,size).then(res => {
            setData(res.content)
            //setPagination({ ...pagination, total: res.totalElements,current: page })
            setPagination({current: page, total: res.totalElements, pageSize: size})
        })

    }

    const handleChange = (pagination:any, filters:any, sorter:any) => {

        setPagination(pagination);

        getPageData(pagination.current,pagination.pageSize)

    };

    // 第一个参数是组件加载完毕后执行的函数，第二个参数只要变化就会执行第一个参数的函数
    useEffect( () => {
        getPageData(pagination.current,pagination.pageSize)
    },[])

    return (
        <div>

            检测规则配置

            <Row>
                <Col span={2}></Col>
                <Col span={20}>
                    <Space wrap>

                        <RuleAdd flush={ () => {
                            getPageData(1,pagination.pageSize)
                        }} />

                    </Space>

                    <Table
                        rowSelection={{
                            type: 'checkbox'
                        }}
                        pagination={pagination}
                        columns={columns}
                        dataSource={data} rowKey="id"
                        onChange={handleChange}
                    >

                    </Table>
                </Col>
                <Col span={2}></Col>
            </Row>
        </div>
    )


}

export default Rule