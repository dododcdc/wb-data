

import React, { useState } from 'react';
import {Button, Modal, Form, Input, message, Space} from 'antd';


import httpclient from "../../utils/httpclient";

interface Props {
    getAll: () => void;
}

const DbAdd:React.FC<Props> = ({getAll}) => {
    const [isModalOpen, setIsModalOpen] = useState(false);

    const [form] = Form.useForm();



    const showModal = () => {
        setIsModalOpen(true);
    };

    const handleOk = () => {

        const data = form.getFieldsValue();


        httpclient.post("/db/add",JSON.stringify(data))
            .then(x  => {
                if (x.data.code === '200') {
                    // 添加成功后调用父组件的方法刷新数据
                    getAll()
                    message.info("添加成功")
                }else {
                    message.error("添加失败")

                }

            })

        setIsModalOpen(false);
    };

    const handleCancel = () => {
        setIsModalOpen(false);
    };

    return (
        <div style={{padding:"20px"}}>
            <Space size="middle">
                <Button onClick={getAll}>刷新</Button>
                <Button type="primary" onClick={showModal}>
                    添加数据源
                </Button>
            </Space>

            <Modal title="Basic Modal" open={isModalOpen} onOk={handleOk} onCancel={handleCancel}>
                <Form
                    name="basic"
                    labelCol={{ span: 8 }}
                    wrapperCol={{ span: 16 }}
                    style={{ maxWidth: 600 }}
                    initialValues={{ remember: true }}
                    onFinish={(values) => false} // 阻止表单默认行为，因为提交表单的动作是在表单外部处理的
                    autoComplete="off"
                    form={form}
                >

                    <Form.Item
                        label="名称"
                        name="name"
                        rules={[{ required: true, message: 'crm数据源' }]}
                    >
                        <Input />
                    </Form.Item>

                    <Form.Item
                        label="地址"
                        name="url"
                        rules={[{ required: true, message: '请输入地址,例如: jdbc:mysql:127.0.0.1:3306' }]}
                    >
                        <Input />
                    </Form.Item>

                    <Form.Item
                        label="用户名"
                        name="username"
                        rules={[{ required: true, message: '请输入用户名' }]}
                    >
                        <Input />
                    </Form.Item>

                    <Form.Item
                        label="密码"
                        name="password"
                        rules={[{ required: true, message: '请输入密码' }]}
                    >
                        <Input />
                    </Form.Item>

                    <Form.Item
                        label="数据库"
                        name="dbName"
                        rules={[{ required: true, message: '请输入默认数据库' }]}
                    >
                        <Input />
                    </Form.Item>

                </Form>
            </Modal>
        </div>
    );
};

export default DbAdd;