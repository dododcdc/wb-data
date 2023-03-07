

import CodeMirror from '@uiw/react-codemirror';
import { xcodeDark } from '@uiw/codemirror-theme-xcode';
import {
    autocompletion,
    completionKeymap,
    completeFromList,
    CompletionContext,
    CompletionResult,
} from '@codemirror/autocomplete';
import {MySQL, sql, SQLDialect} from '@codemirror/lang-sql';


const tables = ['table1', 'table2', 'table3'];
const schemas = ['schema1', 'schema2', 'schema3'];
const columns = ['column1', 'column2', 'column3'];
const keywords = ['select', 'from', 'where', 'group by', 'order by'];


const customCompletion = (context: CompletionContext): CompletionResult => {
    const token = context.matchBefore(/\w+/);
    if (!token) return { from: context.pos, to: context.pos, options: [] };

    const options = [...tables, ...schemas, ...columns, ...keywords].filter(
        (option) => option.startsWith(token.text)
    );

    return {
        from: token.from,
        to: token.to,
        options: options.map((option) => ({ label: option })),
    };
};

function Query () {

    return (

        <CodeMirror
            value="select 1 "
            height="200px"
            theme={xcodeDark}
            extensions={[

                sql({dialect:MySQL}),

                autocompletion({
                override: [
                    customCompletion
                ],
            }),]}
            onChange={(value, viewUpdate) => {
                console.log('value:', value);

            }}
        />
    )
}

export default Query