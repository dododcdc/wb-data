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

export const  getCron = (ruleId:number) => {
    return  Http.get('/job/getCron',{ruleId:ruleId}).then(res => {
        if (res) {
            return res.data
        }else {
            message.error('获取cron表达式失败')
        }
    })
}


export const updateCron = (ruleId:number,cron:string) => {

    return Http.get('/job/updateCron',{ruleId:ruleId,cron:cron})
        .then(res => {

            if (res){
                message.info("更新成功")
            }else {
                message.error("更新失败")
            }
        })

}