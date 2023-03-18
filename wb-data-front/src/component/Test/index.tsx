import React, { useState, useEffect } from 'react';
import TodoService from '../../service/todo/index';

interface Todo {
    id: number;
    title: string;
    completed: boolean;
}

const TodoList: React.FC = () => {
    const [todos, setTodos] = useState<Todo[]>([]);

    useEffect(() => {
        TodoService.getTodoList().then((data) => {
            if (data) {
                setTodos(data);
            }
        });
    }, []);

    const handleAddTodo = () => {
        TodoService.addTodo('新的待办事项').then((res:boolean) => {
            if (res) {
                // 添加成功，重新获取待办事项列表
                TodoService.getTodoList().then((data) => {
                    if (data) {
                        setTodos(data);
                    }
                });
            }
        });
    };

    const handleDeleteTodo = (id: number) => {
        TodoService.deleteTodoById(id).then((res) => {
            if (res) {
                // 删除成功，重新获取待办事项列表
                TodoService.getTodoList().then((data) => {
                    if (data) {
                        setTodos(data);
                    }
                });
            }
        });
    };

    return (
        <div>
            <button onClick={handleAddTodo}>添加新的待办事项</button>
            <ul>
                {todos.map((todo) => (
                    <li key={todo.id}>
                        {todo.title} - {todo.completed ? '已完成' : '未完成'}
                        <button onClick={() => handleDeleteTodo(todo.id)}>删除</button>
                    </li>
                ))}
            </ul>
        </div>
    );
};

export default TodoList;