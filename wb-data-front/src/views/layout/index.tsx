import {  useNavigate ,Outlet,Link } from "react-router-dom";
import { Layout } from 'antd';

import { AppstoreOutlined, MailOutlined, SettingOutlined } from '@ant-design/icons';
import type { MenuProps } from 'antd';
import { Menu } from 'antd';

import logo from '../../assets/cherry.svg'
import { useRef } from 'react';


function WbLayOut() {

    const { Header, Footer, Sider, Content } = Layout;

    const items: MenuProps['items'] = [
        {
            label: '数据监测',
            key: '/',
            icon: <MailOutlined />,
        },
        {
            label: '数据对比',
            key: '/comparison',
            icon: <AppstoreOutlined />
        },
        {
            label: '自助查询',
            key: '/ed',
            icon: <AppstoreOutlined />
        },
        {
            label: '数据源',
            key: '/source',
            icon: <AppstoreOutlined />
        },
        {
            label: '检测规则配置',
            key: '/rule',
            icon: <AppstoreOutlined />
        },

        {
            label: '规则运行结果',
            key: '/result',
            icon: <AppstoreOutlined />
        }
    ];



    const navigate = useNavigate()

    const onClick = (e: any) => {
        navigate(e.key, { replace: true })
    }


    return (
            <Layout  >
                <Header className="header" style={{ position: 'sticky', top: 0, zIndex: 1, width: '100%',color:'white' }} >

                    <img src={logo}  style={{
                        float: 'left',
                        width: 80,
                        height: 65,
                        margin: '0px 0px 0px 0'
                    }} />

                </Header>
                <Layout>
                    <Sider>
                        <Menu style={{minHeight:'500px'}} onClick={onClick}   items={items}  />
                    </Sider>
                    <Content> <Outlet /> </Content>
                </Layout>
                <Footer >Footer</Footer>
            </Layout>
    )
}

export  default WbLayOut
