import { randomUUID } from "node:crypto";

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";

import { dirname } from "node:path";

import { z } from "zod";

export type Priority = "小" | "中" | "大";

const storedTask = z.looseObject({ id: z.string(), title: z.string(), done: z.boolean() });

// Extended fields (dueDate, priority, parentId) are kept as-is by the loose
// schema: the store persists them without knowing about them.
export interface Task {
  id: string;
  title: string;
  done: boolean;
  dueDate?: string; // YYYY-MM-DD
  priority?: Priority;
  parentId?: string;
}

const taskList = z.array(storedTask);

export type TaskChanges = Partial<
  Pick<Task, "title" | "done" | "dueDate" | "priority" | "parentId">
>;

export interface TaskStore {
  list(): Task[];
  create(title: string): Task;
  update(id: string, changes: TaskChanges): Task | undefined;
  remove(id: string): boolean;
}

export function createJsonTaskStore(filename: string): TaskStore {
  function list(): Task[] {
    if (!existsSync(filename)) return [];
    return taskList.parse(JSON.parse(readFileSync(filename, "utf8"))) as Task[];
  }

  // Same-process synchronous read/write; the previous list stays readable
  // until the atomic rename below.
  function save(tasks: Task[]) {
    mkdirSync(dirname(filename), { recursive: true });
    const temporary = filename + ".tmp";
    writeFileSync(temporary, JSON.stringify(tasks, null, 2) + "\n");
    renameSync(temporary, filename);
  }

  return {
    list,
    create(title) {
      const task: Task = { id: randomUUID(), title, done: false };
      save([...list(), task]);
      return task;
    },
    update(id, changes) {
      const tasks = list();
      const task = tasks.find((item) => item.id === id);
      if (!task) return undefined;
      Object.assign(task, changes);
      save(tasks);
      return task;
    },
    remove(id) {
      const tasks = list();
      const remaining = tasks.filter((task) => task.id !== id);
      if (remaining.length === tasks.length) return false;
      save(remaining);
      return true;
    },
  };
}
