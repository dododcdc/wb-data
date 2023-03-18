import Http from "../../utils/HTTP";


import {WbRule} from "./types";



export const findAll = () => {

    return Http.get<WbRule[]>('/rule/all').then(res => {
        if (res) {
            return res.data
        } else {
            return []
        }
    })


}