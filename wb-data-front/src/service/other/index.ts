import Http from "../../utils/HTTP";


import {message} from 'antd';

// 手动临时执行规则
export const  execRule = (wbrule:any) => {

    Http.post<any>("/rule-result/exec-rule",wbrule)
        .then(res=>{

            if (res) {
                message.success("成功");
            }else {
                message.error("失败");
            }

        })
        .catch(err=>{
        message.error(err.message);
    })

}