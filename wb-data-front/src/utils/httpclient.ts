/**
 * 网络请求配置
 */
import axios from "axios";




const request = axios.create({
    baseURL: 'http://localhost:8080/', // 配置 API 地址
    timeout: 10000, // 请求超时时间
    headers: {
        'Content-Type': 'application/json;charset=UTF-8'
    }
})


export default request

