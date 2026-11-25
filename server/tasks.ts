import { Router } from "express";

import { z } from "zod";

import type { TaskStore } from "./task-store.ts";

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式应为 YYYY-MM-DD")
  .refine((value) => !Number.isNaN(Date.parse(value)), "日期无效");

const createTaskSchema = z.strictObject({
  title: z.string().trim().min(1).max(200),
  dueDate: dateSchema.optional(),
  priority: z.enum(["小", "中", "大"]).optional(),
  parentId: z.string().min(1).optional(),
});

const updateTaskSchema = createTaskSchema
  .partial()
  .extend({ done: z.boolean().optional() })
  .refine((changes) => Object.keys(changes).length > 0);

const taskNotFound = { error: "找不到这条任务。" };

export function taskRouter(tasks: TaskStore) {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json(tasks.list());
  });

  router.post("/", (req, res) => {
    const input = createTaskSchema.safeParse(req.body);
    if (!input.success) {
      return res.status(400).json({ error: "请提供 1 至 200 个字符的任务标题。" });
    }
    const { title, ...extra } = input.data;
    const created = tasks.create(title);
    const task = Object.keys(extra).length > 0 ? tasks.update(created.id, extra) : created;
    res.status(201).json(task);
  });

  router.patch("/:id", (req, res) => {
    const input = updateTaskSchema.safeParse(req.body);
    if (!input.success) {
      return res
        .status(400)
        .json({ error: "请提供有效的 title、done、dueDate、priority 或 parentId 字段。" });
    }

    const updated = tasks.update(req.params.id, input.data);
    if (!updated) return res.status(404).json(taskNotFound);
    res.json(updated);
  });

  router.delete("/:id", (req, res) => {
    if (!tasks.remove(req.params.id)) return res.status(404).json(taskNotFound);
    res.sendStatus(204);
  });

  return router;
}
