
import Comparison from './views/Comparison';

import Layout from "./views/Layout";

import Monitoring from './views/Monitoring';

import Query from './views/Query';

import {Routes, Route, HashRouter} from 'react-router-dom'


function App() {

  return (
    <div className="App">
     <HashRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Monitoring />} />
          <Route path="comparison" element={<Comparison />} />
          <Route path="query" element={<Query />} />
        </Route>
      </Routes>
        </HashRouter>
    </div>
  )
}

export default App
