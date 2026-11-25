import type OpenAI from "openai";

import { z } from "zod";

import { resolveTask } from "./resolve.ts";
import type { TaskStore } from "./task-store.ts";

// Tool argument schemas. Every tool failure becomes a JSON-serializable
// observation for the model, never a thrown exception.

const titleSchema = z.string().trim().min(1).max(200);

const createArgs = z.strictObject({ title: titleSchema });
const searchArgs = z.strictObject({ keyword: z.string().trim().min(1).max(100) });
const updateArgs = z.strictObject({
  task: z.string().trim().min(1).max(200), // task id or fuzzy title
  title: titleSchema.optional(),
  done: z.boolean().optional(),
});
const deleteArgs = z.strictObject({ task: z.string().trim().min(1).max(200) });

// JSON schemas handed to the model (OpenAI function-calling format).
export const toolSchemas: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "list_tasks",
      description: "列出全部待办任务（包括已完成的），按创建顺序返回。",
      parameters: { type: "object", properties: {}, required: [] as string[] },
    },
  },
  {
    type: "function",
    function: {
      name: "search_tasks",
      description: "按关键词检索任务标题，返回匹配的任务（可能为空列表）。",
      parameters: {
        type: "object",
        properties: { keyword: { type: "string", description: "检索关键词" } },
        required: ["keyword"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_task",
      description: "新建一条待办任务。title 从用户原话中提炼，简洁明确（1-200 字）。",
      parameters: {
        type: "object",
        properties: { title: { type: "string", description: "任务标题" } },
        required: ["title"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_task",
      description: "修改任务：可改标题、标记完成状态。task 填任务 id 或用户提到的名称。",
      parameters: {
        type: "object",
        properties: {
          task: { type: "string", description: "任务 id 或任务名称" },
          title: { type: "string", description: "新标题（可选）" },
          done: { type: "boolean", description: "true = 已完成，false = 未完成" },
        },
        required: ["task"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_task",
      description: "删除任务。task 填任务 id 或用户提到的名称。",
      parameters: {
        type: "object",
        properties: { task: { type: "string", description: "任务 id 或任务名称" } },
        required: ["task"],
      },
    },
  },
];

export function executeTool(
  name: string,
  rawArgs: unknown,
  tasks: TaskStore,
): Record<string, unknown> {
  try {
    switch (name) {
      case "create_task": {
        const { title } = createArgs.parse(rawArgs);
        return { ok: true, task: tasks.create(title) };
      }
      case "list_tasks":
        return { ok: true, tasks: tasks.list() };
      case "search_tasks": {
        const { keyword } = searchArgs.parse(rawArgs);
        const hits = tasks.list().filter((t) => t.title.includes(keyword));
        return { ok: true, tasks: hits }; // empty list is a valid answer, not an error
      }
      case "update_task": {
        const { task, ...changes } = updateArgs.parse(rawArgs);
        if (Object.keys(changes).length === 0) {
          return { ok: false, error: "请提供 title 或 done 中的一个修改字段。" };
        }
        const found = resolveTask(task, tasks.list());
        if (found.status === "none") {
          return { ok: false, error: "没有找到对应的任务。", hint: "可先用 search_tasks 检索。" };
        }
        if (found.status === "ambiguous") {
          return {
            ok: false,
            error: "有多条任务匹配，请向用户确认是哪一条。",
            candidates: found.candidates,
          };
        }
        const updated = tasks.update(found.task.id, changes);
        return updated ? { ok: true, task: updated } : { ok: false, error: "任务已不存在。" };
      }
      case "delete_task": {
        const { task } = deleteArgs.parse(rawArgs);
        const found = resolveTask(task, tasks.list());
        if (found.status === "none") return { ok: false, error: "没有找到对应的任务。" };
        if (found.status === "ambiguous") {
          return {
            ok: false,
            error: "有多条任务匹配，请向用户确认。",
            candidates: found.candidates,
          };
        }
        return tasks.remove(found.task.id)
          ? { ok: true, deleted: found.task.title }
          : { ok: false, error: "任务已不存在。" };
      }
      default:
        return { ok: false, error: `未知工具：${name}` };
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { ok: false, error: "参数无效，请检查参数格式。", details: z.treeifyError(error) };
    }
    return { ok: false, error: "工具执行出现意外错误。" };
  }
}
