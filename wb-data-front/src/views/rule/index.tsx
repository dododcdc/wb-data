import React, {useEffect, useState} from 'react';

import {WbRule} from '../../service/wbrule/types';
import {ColumnsType} from "antd/es/table";
import {Col, Row, Space, Table} from "antd";
import RuleAdd from "../../component/RuleAdd";


const Rule: React.FC = () => {

    const columns: ColumnsType<WbRule> = [

        {
             title: "规则"
            , dataIndex: 'rule'
            , key: 'rule'
        },

    ]

    const [data, setData] = useState<WbRule[]>([])

    return (
        <div>

            检测规则配置

            <Row>
                <Col span={2}></Col>
                <Col span={20}>
                    <Space wrap>
                        <RuleAdd visible={true} onCancel={() => {}} onOk={() => {}} />

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

export default Rule