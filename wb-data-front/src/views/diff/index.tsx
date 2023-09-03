import {Link, Outlet} from "react-router-dom";
import {Select} from "antd/lib";
import {Breadcrumb, Button, Row} from "antd";
import React from "react";


function Diff() {

    return (

        <div>
            <div style={{width:100,height:20}}></div>


                <Breadcrumb
                    items={[

                        {
                            title: <Link to="/diff">库表选择</Link>,
                        }
                    ]}
                />






           <div> 数据比对第一个界面</div>

            <Button ><Link to="/diff2">下一步</Link></Button>




        </div>
    )


}

export default  Diff