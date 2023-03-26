import React from "react";

export interface WbSource {
    id: React.Key;
    name:string;
    url: string;
    type: string;
    username: string;
    password: string;
    dbName: string;
    createTime: string;
    updateTime: string;
    updateBy: string;
    enabled: string;
}