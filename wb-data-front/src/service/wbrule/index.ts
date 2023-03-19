import Http from "../../utils/HTTP";


import {WbRule} from "./types";


import {message} from 'antd';


export const page = (page:Number, size?:Number) => {

    if (!size) {
        size = 7;
    }

    const data = {
        page:page,
        size:size
    }

    return Http.post<any>('/rule/page',data).then(res => {
        if (res) {
            return res.data
        } else {
            return []
        }
    })


}

export const add= (wbRule:WbRule) => {
    return Http.post<String>('/rule/add',JSON.stringify(wbRule)).then(res => {
        if (res) {
            message.info("添加成功")
            return res.code
        } else {
            message.error("添加失败")
            return []
        }
    })

}


export const del = (id:Number) => {
    return Http.delete<any>('/rule/del/'+id).then(res => {
        if (res) {
            message.info(res.msg)
            return res
        } else {
            message.error("删除失败")
            return null
        }
    })
}