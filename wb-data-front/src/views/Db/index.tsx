
import React, {useEffect, useState} from 'react';


import httpclient from "../../utils/httpclient";
import DbAdd from "../../component/DbAdd";

import { Button, Space } from 'antd';

interface Data {
    id:number;
    url:string;
    type:string;
    username: string;
    password: string;
    db_name: string;
    create_time: string;
    update_time: string;
    update_by: string;
    enabled: string;
}

function Db() {

    const [data,setData] = useState<Data[]|null>(null)

    useEffect(() => {
        httpclient.get("/t/test3")
            .then(x =>{
                const res:Data[] = x.data.data.content;
                setData(res)

            } )

    },[])

    if (!data) {
        return <div>Loading data...</div>;
    }

    return (
        <div>

            <Space wrap>
                <DbAdd />

            </Space>

            <ul>
                {
                    data.map(item => (
                        <li key={item.id} >{item.type}，{item.url}</li>
                    ))
                }
            </ul>
        </div>
    )

}

export default Db