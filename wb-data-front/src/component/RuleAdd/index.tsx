import React, {useEffect, useState} from 'react';
import {Button, Modal, Form, Input, message, Space, Row, Col} from 'antd';
import httpclient from "../../utils/httpclient";

import * as rule from '../../service/wbrule/index'
import {WbRule} from "../../service/wbrule/types";
import {Select} from "antd/lib";

import * as wbsource from "../../service/wbsource";

import {WbSource} from "../../service/wbsource/types";



interface Prop {

    flush: () => void;

}

interface Option {
    value: React.Key;
    label: string;
}

const RuleAdd:React.FC<Prop> = ({flush}) => {

    const [isModalOpen, setIsModalOpen] = useState(false);

    const [form] = Form.useForm();


    const [options,setOptions] = useState<Option[]>([])

    useEffect(() => {

        wbsource.findAll().then(x=>{
            const newarray = x.map(item => ({label:item.name,value:item.id}))
            setOptions(newarray)
        })

    },[])



    const showModal = () => {
        setIsModalOpen(true);
    };

    const handleOk = () => {

        const data:any = form.getFieldsValue();


        rule.add(data).then(x => {
            flush()
        })



        setIsModalOpen(false);
    };

    const handleCancel = () => {
        setIsModalOpen(false);
    };




    return (
        <div>

            <Space size="middle">
                <Button type="primary" onClick={showModal}>
                    添加规则
                </Button>
            </Space>

            <Modal title="请填写规则具体信息"
                   width="40%"
                   open={isModalOpen}
                   onOk={handleOk}
                   onCancel={handleCancel}

            >
                <Form
                    name="basic"
                    labelCol={{ span: 8 }}
                    wrapperCol={{ span: 16 }}
                    style={{ maxWidth: 800 }}
                    initialValues={{ remember: true }}
                    onFinish={(values) => false} // 阻止表单默认行为，因为提交表单的动作是在表单外部处理的
                    autoComplete="off"
                    form={form}
                >

                    <Form.Item
                        label="数据源"
                        name="wbSourceId"
                        rules={[{ required: true, message: '请输入规则名称：user_count ' }]}
                    >
                        <Select
                            showSearch
                            placeholder="Select a dataSource"
                            optionFilterProp="label"
                            filterOption={(input, option) =>
                                (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                            }
                            options={options}
                        />
                    </Form.Item>

                    <Form.Item
                        label="名称"
                        name="name"
                        rules={[{ required: true, message: '请输入规则名称：user_count ' }]}
                    >
                        <Input />
                    </Form.Item>
                    <Form.Item
                        label="规则描述"
                        name="detail"
                        rules={[{ required: true, message: '请输入规则描述,例如: 监控user表的数据量 ' }]}
                    >
                        <Input />
                    </Form.Item>

                    <Form.Item
                        label="规则sql"
                        name="ruleSql"
                        rules={[{ required: true, message: '请输入规则,例如: select count(*) from a ' }]}
                    >
                        <Input />
                    </Form.Item>

        <Row>
            <Col span={4}></Col>
            <Col span={12}>
                <Form.Item
                    label="比较运算符"
                    name="operator"
                >
                    <Select
                        showSearch
                        placeholder="Select a operator"
                        optionFilterProp="label"
                        filterOption={(input, option) =>
                            (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                        }
                        options={[
                            {
                                value: '=',
                                label: '等于'
                            },
                            {
                                value: '>',
                                label: '大于'
                            },
                            {
                                value: '<',
                                label: '小于'
                            },
                            {
                                value: '>=',
                                label: '大于或等于'
                            },
                            {
                                value: '<=',
                                label: '小于或等于'
                            },
                        ]}
                    />
                </Form.Item>
            </Col>

            <Col span={8}>

                <Form.Item
                    label="阈值"
                    name="threshold"
                    rules={[{ required: true, message: '请输入规则阈值 ' }]}
                >
                    <Input />
                </Form.Item>
            </Col>
        </Row>




                </Form>
            </Modal>


        </div>
    )


    
}


export default RuleAdd