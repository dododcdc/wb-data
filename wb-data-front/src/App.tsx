
import Comparison from './views/comparison';

import Layout from "./views/layout";

import Monitoring from './views/monitoring';

import Query from './views/query/indexbak';

import Db from './views/db'

import Rule from './views/rule'

import Result from './views/result'

import {Routes, Route, HashRouter} from 'react-router-dom'
import ED from "./views/query/index";


function App() {
  return (
    <div className="App">
     <HashRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Monitoring />} />
          <Route path="comparison" element={<Comparison />} />
          <Route path="ed" element={<ED />} />
          <Route path="source" element={<Db />} />
          <Route path="rule" element={<Rule />} />
          <Route path="result" element={<Result />} />
        </Route>
      </Routes>
        </HashRouter>
    </div>
  )
}

export default App
