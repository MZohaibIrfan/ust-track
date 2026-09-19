import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function AgentMarkdown({ children }: { children: string }) {
  return (
    <div className="agent-md rounded-md bg-bg px-3 py-2 text-[13px] leading-5">
      <Markdown remarkPlugins={[remarkGfm]}>{children.trim()}</Markdown>
    </div>
  );
}
