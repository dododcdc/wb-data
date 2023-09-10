create table wb_job
(
    id                 int unsigned auto_increment comment '主键'
        primary key,
    job_name           varchar(255)                         null comment 'job名称',
    job_group_name     varchar(255)                         null comment 'job组名称',
    trigger_name       varchar(255)                         null comment 'trigger名称',
    trigger_group_name varchar(255)                         null comment 'trigger组名称',
    class_name         varchar(255)                         null comment 'class类路径',
    job_data           varchar(255)                         null comment '任务参数',
    create_time        datetime   default CURRENT_TIMESTAMP null comment '创建时间',
    update_time        datetime   default CURRENT_TIMESTAMP null on update CURRENT_TIMESTAMP comment '创建时间',
    create_by          varchar(50)                          null comment '创建人',
    update_by          varchar(50)                          null comment '更新人',
    deleted            tinyint(1) default 0                 null comment '是否删除:1删除;0未删除'
)
    comment 'job表' charset = utf8;

create table wb_rule
(
    id           int unsigned auto_increment comment '主键'
        primary key,
    wb_source_id int(10)                               not null comment '数据源id',
    name         varchar(255)                          null comment '规则名称',
    detail       varchar(255)                          null comment '规则描述',
    rule_sql     text                                  null comment '规则sql',
    threshold    double                                null comment '阈值',
    operator     varchar(10) default '>'               null comment '运算符',
    create_time  datetime    default CURRENT_TIMESTAMP null comment '创建时间',
    update_time  datetime    default CURRENT_TIMESTAMP null on update CURRENT_TIMESTAMP comment '创建时间',
    create_by    varchar(50)                           null comment '创建人',
    update_by    varchar(50)                           null comment '更新人',
    deleted      tinyint(1)  default 0                 null comment '是否删除:1删除;0未删除'
)
    comment '规则表' charset = utf8;

create table wb_rule_result
(
    id           int unsigned auto_increment comment '主键'
        primary key,
    wb_rule_id   int(10)                              not null comment '规则id',
    result       double                               null comment '结果值',
    is_exception int(3)                               null comment '是否异常;1异常0正常',
    create_time  datetime   default CURRENT_TIMESTAMP null comment '创建时间',
    update_time  datetime   default CURRENT_TIMESTAMP null on update CURRENT_TIMESTAMP comment '创建时间',
    create_by    varchar(50)                          null comment '创建人',
    update_by    varchar(50)                          null comment '更新人',
    deleted      tinyint(1) default 0                 null comment '是否删除:1删除;0未删除'
)
    comment '规则执行结果表' charset = utf8;

create table wb_source
(
    id                int unsigned auto_increment comment '主键'
        primary key,
    name              varchar(100)                       not null comment '名称',
    type              varchar(100)                       null comment '数据源类型',
    url               varchar(100)                       null comment '地址',
    driver_class_name varchar(50)                        null comment '驱动类',
    username          varchar(255)                       null comment '用户名',
    password          varchar(255)                       null comment '密码',
    db_name           varchar(255)                       null comment '数据库名称',
    create_time       datetime default CURRENT_TIMESTAMP null comment '创建时间',
    update_time       datetime default CURRENT_TIMESTAMP null on update CURRENT_TIMESTAMP comment '创建时间',
    create_by         varchar(50)                        null comment '创建人',
    update_by         varchar(50)                        null comment '更新人',
    deleted           tinyint(1)                         null comment '是否删除:1删除;0未删除'
)
    comment '数据源' charset = utf8;

