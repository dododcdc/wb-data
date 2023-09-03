import { Breadcrumb } from "antd";
import React from "react";
import {Link} from "react-router-dom";


export default function Diff2 (){

    return (

        <div>
            <div style={{width:100,height:20}}></div>

            <Breadcrumb
                items={[

                    {
                        title: <Link to="/diff">库表选择</Link>,
                    },
                    {
                        title: <Link to="/diff2">字段选择</Link>,
                    }
                ]}
            />
            数据比对第二个页面
        </div>
    )
}