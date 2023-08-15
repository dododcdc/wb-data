import Http from "../../utils/HTTP";
import {message} from "antd";



export const add= (jobMsg:any) => {

    return Http.post<String>('/job/add',JSON.stringify(jobMsg)).then(res => {
        if (res) {
            message.info("添加成功")
            return res.code
        } else {
            message.error("添加失败")
            return []
        }
    })

}

export const delAll = () => {

    return Http.get('/job/clear').then(res => {
        if (res) {
            message.info("清除成功")
            return res.code
        } else {
            message.error("清除失败")
            return []
        }
    })


}