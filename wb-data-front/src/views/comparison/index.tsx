import {useState} from "react";
import {Link, Outlet} from "react-router-dom";
import {Button} from "antd";


function Comparison() {


    const [count, setCount] = useState(0)




    return (
        <div>数据对比 待开发

            <button onClick={ () =>setCount( count + 1 )}>{count}</button>

            <Button ><Link to="/diff">新建对比任务</Link></Button>

            {/*<Button><Link to="/diff">库表选择</Link></Button>*/}

            {/*<Button><Link to="/diff2">字段选择</Link></Button>*/}



        </div>
    )
}

export  default     Comparison