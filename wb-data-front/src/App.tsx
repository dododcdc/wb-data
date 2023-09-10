
import Comparison from './views/comparison';

import Layout from "./views/layout";

import Monitoring from './views/monitoring';

import Query from './views/query/indexbak';

import Db from './views/db'

import Rule from './views/rule'

import Result from './views/result'

import {Routes, Route, HashRouter} from 'react-router-dom'
import ED from "./views/query/index";
import Diff from "./views/diff";
import Diff2 from "./views/diff2";


function App() {
  return (
    <div className="App">
     <HashRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          {/*<Route index element={<Monitoring />} />*/}
          <Route index element={<ED />} />
          <Route path="comparison" element={<Comparison />} />

          <Route path="source" element={<Db />} />
          <Route path="rule" element={<Rule />} />
          <Route path="result" element={<Result />} />
            <Route path="diff" element={<Diff />} />
            <Route path="diff2" element={<Diff2 />} />
        </Route>
      </Routes>
        </HashRouter>
    </div>
  )
}

export default App
