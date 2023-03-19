import React, { useState } from 'react';
import {Button, Modal, Form, Input, message, Space} from 'antd';
import httpclient from "../../utils/httpclient";

import * as rule from '../../service/wbrule/index'
import {WbRule} from "../../service/wbrule/types";



interface Prop {

    flush: () => void;

}

const RuleAdd:React.FC<Prop> = ({flush}) => {

    const [isModalOpen, setIsModalOpen] = useState(false);

    const [form] = Form.useForm();



    const showModal = () => {
        setIsModalOpen(true);
    };

    const handleOk = () => {

        const data:WbRule = form.getFieldsValue();

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

            <Modal title="请填写规则具体信息" open={isModalOpen} onOk={handleOk} onCancel={handleCancel}>
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
                        rules={[{ required: true, message: '请输入规则名称：user_count ' }]}
                    >
                        <Input />
                    </Form.Item>
                    <Form.Item
                        label="规则描述"
                        name="desc"
                        rules={[{ required: true, message: '请输入规则描述,例如: 监控user表的数据量 ' }]}
                    >
                        <Input />
                    </Form.Item>

                    <Form.Item
                        label="规则sql"
                        name="rule"
                        rules={[{ required: true, message: '请输入规则,例如: select count(*) from a ' }]}
                    >
                        <Input />
                    </Form.Item>


                </Form>
            </Modal>


        </div>
    )


    
}


export default RuleAdd