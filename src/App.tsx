import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import type { ChatMessage } from "../shared/chat.ts";

import { requestReply } from "./chat-client.ts";

import { ChatHistory } from "./ChatHistory.tsx";

interface TaskItem {
  id: string;
  title: string;
  done: boolean;
  dueDate?: string;
  priority?: string;
  parentId?: string;
}

function isSendShortcut(event: KeyboardEvent<HTMLTextAreaElement>) {
  // 中文输入法会用 Enter 确认选词，部分浏览器此时只报告键码 229。
  const composing = event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229;
  return event.key === "Enter" && !event.shiftKey && !composing;
}

export default function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);

  // The task panel is a live view of the same store the agent writes to.
  async function refreshTasks() {
    try {
      const response = await fetch("/api/tasks");
      if (response.ok) setTasks((await response.json()) as TaskItem[]);
    } catch {
      // best-effort panel: the chat keeps working without it
    }
  }

  useEffect(() => {
    void refreshTasks();
  }, []);

  async function send(text: string) {
    const content = text.trim();
    if (!content || pending) return;
    const outgoing: ChatMessage[] = [...messages, { role: "user", content }];
    setMessages(outgoing);
    setDraft("");
    setPending(true);
    setError("");
    try {
      const answer = await requestReply(outgoing);
      setMessages([...outgoing, { role: "assistant", content: answer }]);
      void refreshTasks();
    } catch (cause) {
      setMessages(messages);
      setDraft(text);
      setError(cause instanceof Error ? `发送失败：${cause.message}` : "发送失败，请重试。");
    } finally {
      setPending(false);
      requestAnimationFrame(() => input.current?.focus());
    }
  }

  return (
    <div className="app">
      <header>
        <img src="/logo.png" alt="" />
        <strong>TokeNow</strong>
        <span>小明智能体</span>
      </header>
      <main>
        <div className="chat">
          <ChatHistory messages={messages} pending={pending} onSelectPrompt={send} />
          <div className="compose">
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void send(draft);
              }}
            >
              <textarea
                aria-label="消息"
                ref={input}
                placeholder="输入消息…"
                rows={2}
                value={draft}
                readOnly={pending}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (isSendShortcut(event)) {
                    event.preventDefault();
                    void send(draft);
                  }
                }}
              />
              <button className="send" disabled={pending || !draft.trim()} aria-label="发送消息">
                ↑
              </button>
            </form>
            <small>Enter 发送 · Shift + Enter 换行</small>
          </div>
        </div>
        <aside className="task-panel" aria-label="待办清单">
          <h2>待办清单</h2>
          {tasks.length === 0 ? (
            <p className="empty">清单是空的，和小明说句话试试。</p>
          ) : (
            <ul>
              {tasks.map((task) => (
                <li key={task.id} className={task.done ? "done" : ""}>
                  <span aria-hidden="true">{task.done ? "✅" : "⬜"}</span> {task.title}
                  {task.priority && <em>优先级 {task.priority}</em>}
                  {task.dueDate && <small>截止 {task.dueDate}</small>}
                </li>
              ))}
            </ul>
          )}
        </aside>
      </main>
    </div>
  );
}
