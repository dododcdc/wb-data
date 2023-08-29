import Http from "../../utils/HTTP";


import {message} from 'antd';
import HTTP from "../../utils/HTTP";

import { Result } from "./types"



export const page = (page:number,size?:number) => {

    if (!size) size = 7
    const data = {
        page: page
        ,size: size
    }

    return HTTP.post<any>("/rule-result/page",data).then(res => {

        if (res) {
            console.log(res.data)
            return res.data
        }
        else {
            return []
        }

    })


}

