import Http from '../../utils/HTTP';

import {Todo} from "./typings";


class TodoService {
    public static async getTodoList(): Promise<Todo[] | null> {
        const res = await Http.get<Todo[]>('https://jsonplaceholder.typicode.com/todos');
        if (res) {
            return res.data;
        } else {
            return null;
        }
    }

    public static async addTodo(title: string): Promise<boolean> {
        const res = await Http.post('https://jsonplaceholder.typicode.com/todos', { title, completed: false });
        if (res) {
            return true;
        } else {
            return false;
        }
    }

    public static async deleteTodoById(id: number): Promise<boolean> {
        const res = await Http.post(`https://jsonplaceholder.typicode.com/todos/${id}`, { completed: true });
        if (res) {
            return true;
        } else {
            return false;
        }
    }
}

export default TodoService;