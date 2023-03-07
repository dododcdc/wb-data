/**
 * 网络请求配置
 */
import axios from "axios";

axios.defaults.timeout = 100000;
axios.defaults.baseURL = "http://localhost:8080/";


export default axios

