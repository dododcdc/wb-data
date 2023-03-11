
import React, {useEffect, useState} from 'react';


import httpclient from "../../utils/httpclient";
import DbAdd from "../../component/DbAdd";

import {  Space,Table,Button } from 'antd';
import {ColumnsType} from "antd/es/table";

interface Data {
    id: React.Key;
    url: string;
    type: string;
    username: string;
    password: string;
    db_name: string;
    create_time: string;
    update_time: string;
    update_by: string;
    enabled: string;
}

const columns:ColumnsType<Data> = [


    {
        title:"url"
        ,dataIndex: 'url'
        ,render: (text: string) => <Button>{text}</Button>
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
    }
]


interface Props {
    title: string;
}



const Db:React.FC<Props> = ({title}) => {

    const [data,setData] = useState<Data[]|null>(null)

    const getAll = () => {
        httpclient.get("/t/test3")
            .then(x =>{
                const res:Data[] = x.data.data.content;
                setData(res)
            } )
    }



    useEffect(() => {
            getAll()
    },[])

    if (!data) {
        return <div>Loading data...</div>;
    }

    return (
        <div>
            <h1>{title}</h1>

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

        </div>
    )

}

export default Db