
import React from "react";


export interface WbRule {
    id: React.Key,
    name: string,
    desc: string,
    rule: string,
    create_time: string;
    update_time: string;
    update_by: string;
    enabled: string;
}