import { z } from 'zod'
import { defineTool, type Tool } from './tool.js'

export type TodoStatus = 'pending' | 'in_progress' | 'completed'
export interface TodoItem {
  content: string
  status: TodoStatus
}

/** 会话级 TODO 状态（内存），供 UI 状态栏与上下文注入读取。 */
let currentTodos: TodoItem[] = []

export function getTodos(): TodoItem[] {
  return currentTodos
}
export function setTodos(t: TodoItem[]): void {
  currentTodos = t
}
export function clearTodos(): void {
  currentTodos = []
}

const STATUS_ICON: Record<TodoStatus, string> = {
  pending: '[ ]',
  in_progress: '[~]',
  completed: '[x]',
}

export const TodoWriteTool = defineTool({
  name: 'TodoWrite',
  description: '创建/更新当前任务的待办清单。',
  prompt:
    '维护一个结构化任务清单帮助拆解与跟踪复杂任务。每次传入完整清单（会覆盖旧清单）。同一时刻最多一个 in_progress。',
  inputSchema: z.object({
    todos: z
      .array(
        z.object({
          content: z.string(),
          status: z.enum(['pending', 'in_progress', 'completed']),
        }),
      )
      .describe('完整的待办列表'),
  }),
  isReadOnly: () => false,
  needsPermission: () => false,
  renderInput: i => `${i.todos.length} 项待办`,
  async execute(input) {
    setTodos(input.todos as TodoItem[])
    const rendered = input.todos
      .map(t => `${STATUS_ICON[t.status]} ${t.content}`)
      .join('\n')
    const done = input.todos.filter(t => t.status === 'completed').length
    return {
      content: `待办已更新（${done}/${input.todos.length} 完成）:\n${rendered}`,
      summary: `待办 ${done}/${input.todos.length}`,
    }
  },
}) as Tool
