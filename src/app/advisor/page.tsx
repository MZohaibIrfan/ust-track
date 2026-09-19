"use client";

import { useRef, useState } from "react";

type ChatMessage = { role: "user" | "assistant"; content: string };

const STARTERS = [
  "What does the COMP major require in year one?",
  "Find common core courses under 3 credits",
  "Start a plan for a 2025 IBM intake",
];

export default function AdvisorPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  async function send(text: string) {
    if (!text.trim() || busy) return;
    setError(null);
    const next: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages([...next, { role: "assistant", content: "" }]);
    setInput("");
    setBusy(true);

    try {
      const res = await fetch("/api/advisor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next }),
      });

      if (!res.ok || !res.body) {
        setError(await res.text());
        setMessages(next);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setMessages([...next, { role: "assistant", content: acc }]);
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
      }
    } catch {
      setError("Couldn't reach the advisor. Check the server is running.");
      setMessages(next);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 py-8 sm:py-12">
      <h1 className="font-display text-3xl font-semibold">Advisor</h1>
      <p className="mt-2 text-muted">
        Asks the same catalog and pathway data you see elsewhere in the app, and can
        draft a semester-by-semester plan for you.
      </p>

      <div
        ref={scrollRef}
        className="mt-6 flex flex-1 flex-col gap-4 overflow-y-auto border border-line bg-surface p-5"
        style={{ minHeight: "24rem", maxHeight: "60vh" }}
      >
        {messages.length === 0 ? (
          <div className="m-auto flex flex-col items-center gap-3 text-center">
            <p className="text-sm text-muted">Try asking:</p>
            <div className="flex flex-col gap-2">
              {STARTERS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="border border-line px-4 py-2 text-sm transition-colors hover:bg-accent-soft"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m, i) => (
            <div
              key={i}
              className={`max-w-[85%] whitespace-pre-wrap px-4 py-3 text-sm leading-6 ${
                m.role === "user"
                  ? "ml-auto bg-accent text-accent-ink"
                  : "mr-auto bg-accent-soft"
              }`}
            >
              {m.content || (busy && i === messages.length - 1 ? "…" : "")}
            </div>
          ))
        )}
      </div>

      {error ? (
        <p className="mt-3 border border-line bg-accent-soft px-4 py-3 text-sm">
          {error}
        </p>
      ) : null}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="mt-4 flex gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about courses, pathways, or a plan…"
          disabled={busy}
          className="flex-1 border border-line bg-surface px-4 py-3 text-sm outline-none focus:border-accent"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="bg-accent px-5 py-3 text-sm font-medium text-accent-ink transition-opacity disabled:opacity-40"
        >
          Send
        </button>
      </form>
    </main>
  );
}
