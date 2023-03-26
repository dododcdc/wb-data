
import React from "react";



export interface WbRule {
    id: React.Key;
    name: string;
    detail: string;
    ruleSql: string;
    threshold:Number;
    operator:string;
    createTime: string;
    updateTime: string;
    updateBy: string;
    enabled: string;
    wbSourceId: Number;
}