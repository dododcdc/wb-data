import {useState} from "react";


function Comparison() {


    const [count, setCount] = useState(0)


    return (
        <div>数据对比

            <button onClick={ () =>setCount( count + 1 )}>{count}</button>

        </div>
    )
}

export  default     Comparison