import React, {useEffect, useState} from 'react';

import {WbRule} from '../../service/wbrule/types';
import {ColumnsType} from "antd/es/table";


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
        </div>
    )


}

export default Rule