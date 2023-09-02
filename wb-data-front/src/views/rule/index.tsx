import React, {useEffect, useState} from 'react';

import {WbRule} from '../../service/wbrule/types';
import {ColumnsType} from "antd/es/table";
import {Button, Col, Popconfirm, Modal, Form, Row, Space, Table, Tooltip, Input, InputNumber} from "antd";
import { DashboardOutlined,RightCircleOutlined,DeleteOutlined} from '@ant-design/icons';
import RuleAdd from "../../component/RuleAdd";

import * as job from '../../service/job/index';

import * as wbRule from "../../service/wbrule/index";

import moment from 'moment';

import { execRule } from '../../service/other/index';


const Rule: React.FC = () => {

    const columns: ColumnsType<WbRule> = [
        {
            title: "规则名称"
            , dataIndex: 'name'
            , key: 'name'
        },
        {
            title: "规则描述"
            , dataIndex: 'detail'
            , key: 'detail'
        },
        {
             title: "规则sql"
            , dataIndex: 'ruleSql'
            , key: 'ruleSql'
        },
        {
            title: "阈值"
            , dataIndex: 'threshold'
            , key: 'threshold'
        },
        {
            title: "比较符"
            , dataIndex: 'operator'
            , key: 'operator'
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
            title:"操作"
            ,key:"action"
            , render: (text, record) => (

                    <Space wrap>

                        <Tooltip title="临时执行">
                            <Button type="primary"  shape="circle" icon={<RightCircleOutlined />}
                                    onClick={ () => exec(record) }
                            />
                        </Tooltip>

                        <Tooltip title="配置调度">
                            <Button type="primary" shape="circle" icon={<DashboardOutlined />} onClick={ () => showModal(record.id) } />
                        </Tooltip>

                    <Popconfirm
                        title="确定要删除吗?"
                        onConfirm={() => del(record.id)}
                        okText="确定"
                        cancelText="取消"
                    >
                        <Tooltip title="删除">
                        <Button type="primary" danger shape="circle" icon={<DeleteOutlined />} />
                        </Tooltip>
                    </Popconfirm>

                    </Space>

            )
        }

    ]

    const [form] = Form.useForm();

    const [data, setData] = useState<any>([])

    const [pagination, setPagination] = useState<any>({ current: 1, pageSize: 10,total:0 });

    const [isExists ,setIsExists] = useState<boolean>(false)

    // 临时执行规则
    const exec = (wbrule:any) => {

        execRule(wbrule)

    }

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



    const [open, setOpen] = useState(false);
    const [confirmLoading, setConfirmLoading] = useState(false);



    const  showModal = (ruleId:any) => {

      job.getCron(ruleId).then(x => {
          if (x !== null && x !== "") {
              form.setFieldValue("cron",x);
              setIsExists(true)
          }
      })



        form.setFieldValue('ruleId',ruleId);


        setOpen(true);

    };

    const handleOk = () => {

        setConfirmLoading(true);
        const data = form.getFieldsValue()


        if (isExists) {

            job.updateCron(data.ruleId,data.cron)

        }else {

            job.add(data)
        }


        setConfirmLoading(false);

        setOpen(false);

    };

    const handleCancel = () => {
        console.log('Clicked cancel button');
        setOpen(false);
    };





    return (
        <div>



            {/*<Row>*/}
                {/*<Col span={2}></Col>*/}
                {/*<Col span={20}>*/}
                    <Space wrap>

                        <RuleAdd flush={ () => {
                            getPageData(1,pagination.pageSize)
                        }} />


                    </Space>

            <Space>
                <Button onClick={ () => {job.delAll()}} > 清除所有调度</Button>
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
                {/*</Col>*/}
                {/*<Col span={2}></Col>*/}
            {/*</Row>*/}

            <Modal
                title="Title"
                open={open}
                onOk={handleOk}
                confirmLoading={confirmLoading}
                onCancel={handleCancel}
            >
                <Form form={form}>
                    <Form.Item name='ruleId' style={{ display: 'none' }} >
                        <InputNumber  type="hidden" />

                    </Form.Item>

                    <Form.Item name='cron' label="cron" >
                        <Input />

                    </Form.Item>
                </Form>
            </Modal>


        </div>
    )


}

export default Rule