import OpenAI from "openai";

import type { CallModel, ModelMessage, ModelTurn } from "./agent.ts";
import { toolSchemas } from "./tools.ts";

export const model = process.env.DEEPSEEK_MODEL || "deepseek-flash";

export function getModelClient(): OpenAI {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("请在 .env 中设置 DEEPSEEK_API_KEY 后重启服务。");
  return new OpenAI({ apiKey, baseURL: "https://api.deepseek.com" });
}

// Production adapter: converts our SDK-independent ModelMessage[] to the
// OpenAI format, calls DeepSeek, and parses tool_calls back into a ModelTurn.
export function createDeepSeekCallModel(): CallModel {
  const client = getModelClient();
  return async (messages: ModelMessage[]): Promise<ModelTurn> => {
    const response = await client.chat.completions.create({
      model,
      messages: messages.map(toOpenAIMessage),
      tools: toolSchemas,
      tool_choice: "auto",
    });
    const message = response.choices[0]?.message;
    if (!message) return { content: null, toolCalls: [] };
    const toolCalls = (message.tool_calls ?? [])
      .filter((call) => call.type === "function")
      .map((call) => ({
        id: call.id,
        name: call.function.name,
        args: safeJsonParse(call.function.arguments),
      }));
    return { content: message.content, toolCalls };
  };
}

function toOpenAIMessage(message: ModelMessage): OpenAI.Chat.ChatCompletionMessageParam {
  if (message.role === "tool") {
    return { role: "tool", tool_call_id: message.toolCallId, content: message.content };
  }
  if (message.toolCalls && message.toolCalls.length > 0) {
    return {
      role: message.role,
      content: message.content,
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id,
        type: "function" as const,
        function: { name: call.name, arguments: JSON.stringify(call.args) },
      })),
    };
  }
  return { role: message.role, content: message.content };
}

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
