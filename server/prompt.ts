import { formatTaskList, todayShanghaiDate } from "./task-utils.ts";
import type { TaskStore } from "./task-store.ts";

const SNAPSHOT_LIMIT = 20;

// System prompt with injected state: current date (Asia/Shanghai) and a
// bounded snapshot of open tasks, so long-term memory survives a page reload.
export function buildSystemPrompt(tasks: TaskStore): string {
  const open = tasks
    .list()
    .filter((t) => !t.done)
    .slice(-SNAPSHOT_LIMIT);
  const snapshot = formatTaskList(open);
  return `你是「小明」，一个帮助用户管理待办清单的智能助手。今天是 ${todayShanghai()}，北京时间日期是 ${todayShanghaiDate()}。

当前未完成待办：
${snapshot}

规则：
1. 任何对待办的增、查、改、删都必须通过工具完成，不要凭记忆回答清单内容。
2. update_task 和 delete_task 的 task 参数可以是任务 id 或任务名称（不必完全一致）。
3. 工具返回 candidates 时，向用户列出选项并确认，不要擅自选择。
4. 工具返回错误时，向用户解释或修正参数后重试，不要一味道歉。
5. 用户说「X好了」「X做完了」时，先用 search_tasks 找到任务，再用 update_task 按返回的 id 标记完成。
6. 用户问「今天有哪些任务到期？」时，调用 list_tasks_due_today，不要自己猜日期。
7. 用户提到「今天/明天/后天」或具体日期（如 11月28日）时，换算成 YYYY-MM-DD 填 dueDate；提到「重要/紧急」可设 priority 为「大」。
8. 列出任务时，未完成用 ⬜、已完成用 ✅，并标注优先级和到期日；始终用简洁的中文回复。`;
}

function todayShanghai(): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(new Date());
}
