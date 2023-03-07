import React from 'react';

import httpclient from "../../utils/httpclient.js";

class Test  extends React.Component {
    state = {

        name: ""
    }

    componentDidMount() {
        httpclient.get("/t/test1")
            .then(res => {
               this.setState({name:res.data.code}) ;
            })
    }

    render() {
        return (

            <div>{this.state.name}</div>
        )
    }

}

export default Test;