import type { ChatMessage } from "../shared/chat.ts";

import { buildSystemPrompt } from "./prompt.ts";
import type { TaskStore } from "./task-store.ts";
import { executeTool } from "./tools.ts";

export type { ChatMessage } from "../shared/chat.ts";

// Minimal model-facing types, independent of the OpenAI SDK so tests can
// script turns without any network call.
export interface ToolCall {
  id: string;
  name: string;
  args: unknown;
}

export interface ModelTurn {
  content: string | null;
  toolCalls: ToolCall[];
}

export type ModelMessage =
  | { role: "system" | "user" | "assistant"; content: string; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; content: string };

export type CallModel = (messages: ModelMessage[]) => Promise<ModelTurn>;

export interface AgentDeps {
  tasks: TaskStore;
  callModel?: CallModel;
}

const HISTORY_WINDOW = 20;
const MAX_STEPS = 6;

export function createAgent({ tasks, callModel }: AgentDeps) {
  return async function reply(messages: ChatMessage[]): Promise<string> {
    if (!callModel) return "你好，欢迎使用小明智能体";
    try {
      const convo: ModelMessage[] = [
        { role: "system", content: buildSystemPrompt(tasks) },
        ...messages.slice(-HISTORY_WINDOW).map((m) => ({ role: m.role, content: m.content })),
      ];
      for (let step = 0; step < MAX_STEPS; step++) {
        const turn = await callModel(convo);
        if (turn.toolCalls.length === 0) {
          return turn.content?.trim() || "抱歉，我没有理解你的意思，能换一种说法吗？";
        }
        convo.push({ role: "assistant", content: turn.content ?? "", toolCalls: turn.toolCalls });
        for (const call of turn.toolCalls) {
          const result = executeTool(call.name, call.args, tasks);
          convo.push({ role: "tool", toolCallId: call.id, content: JSON.stringify(result) });
        }
      }
      return "抱歉，这一轮操作太复杂了，我们分开一步一步说吧。"; // step cap reached
    } catch {
      return "服务暂时不可用，请稍后再试。"; // 429/5xx from the model provider
    }
  };
}
