


import Http from "../../utils/HTTP";


import {WbSource} from "./types";



export const findAll = () => {

    return Http.get<WbSource[]>('/db/all').then(res => {
        if (res) {
            return res.data
        } else {
            return []
        }
    })


}

