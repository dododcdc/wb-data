import React from "react";

export interface WbSource {
    id: React.Key;
    url: string;
    type: string;
    username: string;
    password: string;
    db_name: string;
    create_time: string;
    update_time: string;
    update_by: string;
    enabled: string;
}