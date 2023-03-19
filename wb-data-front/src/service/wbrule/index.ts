import Http from "../../utils/HTTP";


import {WbRule} from "./types";



export const page = (page:Number, size?:Number) => {

    if (!size) {
        size = 7;
    }

    const data = {
        page:page,
        size:size
    }

    return Http.post<WbRule[]>('/rule/page',data).then(res => {
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
            return res.data
        } else {
            return []
        }
    })

}


export const del = (id:Number) => {
    return Http.get<WbRule>('/rule/del',id).then(res => {
        if (res) {
            return res.data
        } else {
            return []
        }
    })
}