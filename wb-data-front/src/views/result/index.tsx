import React, {useEffect, useState} from 'react';

import { page } from '../../service/result/index';

import {Button, Col, Popconfirm, Modal, Form, Row, Space, Table, Tooltip, Input, InputNumber, Tag} from "antd";


import {ColumnsType} from "antd/es/table";
import {WbRule} from "../../service/wbrule/types";



const Result:React.FC = () => {


    const [pagination, setPagination] = useState<any>({ current: 1, pageSize: 10,total:0 });
    const [data, setData] = useState<any>([])

    const columns: ColumnsType<any> = [
        {
            title: "规则名称"
            , dataIndex: ["wbRule", "name"]
            , key: 'name'
        },
        {
            title:"运行结果"
            ,dataIndex:'result'
            ,key:'result'

        },
        {
            title: "是否异常"
            , dataIndex: 'isException'
            , key: 'isException'
            ,render: (text) => (
                <div>

                    {text === "0" ? (
                        <Tag color="green">正常</Tag>
                    ) : (
                        <Tag color="red">异常</Tag>
                    )}

                </div>
            )
        },
        {
            title:"更新时间"
            ,dataIndex: 'updateTime'
            ,key: 'updateTime'
        }

        ]


    const getPageData = (a: number,b:number) => {
        page(a,b).then(res => {


            setData(res.content)

            setPagination({current: a, total: res.totalElements, pageSize: b})
        })

    }

    const handleChange = (pagination:any, filters:any, sorter:any) => {

        setPagination(pagination);

        getPageData(pagination.current,pagination.pageSize)

    };

    useEffect( () => {
        getPageData(pagination.current,pagination.pageSize)
    },[])



    return (
      <div>
          result 开发中

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
      </div>
  )


}

export default Result