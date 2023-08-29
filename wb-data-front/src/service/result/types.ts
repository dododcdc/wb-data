import React from "react";

export  interface Result {

    id?: React.Key,
    createTime?: string,
    updateTime?: string,
    create_by?: string,
    update_by?: string,
    deleted?: number,
    wbRuleId?: number,
    result?: number,
    isException?: number,
    wbRule?: {
        id?: number,
        createTime?: string,
        updateTime?: string,
        create_by?: string,
        update_by?: string,
        deleted?: number,
        wbSourceId?: number,
        name?: string,
        detail?: string,
        ruleSql?: string,
        threshold?: number,
        operator?: string

    }

}