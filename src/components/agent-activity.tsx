import { getToolName, isToolUIPart, type UIMessage } from "ai";
import { Streamdown } from "streamdown";
import { code } from "@streamdown/code";
import { Brain, Send, Settings2, StopCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

/** One agent tool call rendered as a compact chip (spinning while running, ✓ when done). */
function ToolChip({ part }: { part: UIMessage["parts"][number] }) {
  if (!isToolUIPart(part)) return null;
  const name = getToolName(part);
  const running =
    part.state === "input-available" || part.state === "input-streaming";
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border bg-muted px-2 py-1 text-xs text-muted-foreground">
      <Settings2
        className={cn(
          "size-3",
          running ? "animate-spin text-primary" : "text-foreground/60"
        )}
      />
      <span className="font-mono">{name}</span>
      <span>{running ? "…" : "✓"}</span>
    </span>
  );
}

function ReasoningBlock({ text, done }: { text: string; done: boolean }) {
  return (
    <Collapsible defaultOpen={!done} className="w-full">
      <CollapsibleTrigger className="flex w-full cursor-pointer items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-1.5 text-xs select-none">
        <Brain className="size-3.5 text-primary" />
        <span className="font-medium text-foreground">Suy luận của AI</span>
        <span className="text-muted-foreground">
          {done ? "Hoàn tất" : "Đang nghĩ…"}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <pre className="mt-1.5 max-h-56 overflow-auto rounded-lg bg-muted px-3 py-2 text-xs whitespace-pre-wrap">
          {text}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * Live agent activity: the real `UIMessage[]` stream from useAgentChat rendered
 * as tool chips, collapsible reasoning, and the streamed markdown answer, plus a
 * follow-up input. This is wired to the actual agent — not mock data.
 */
export function AgentActivity({
  messages,
  isStreaming,
  onStop,
  followUp,
  onFollowUpChange,
  onSend,
  connected,
}: {
  messages: UIMessage[];
  isStreaming: boolean;
  onStop: () => void;
  followUp: string;
  onFollowUpChange: (v: string) => void;
  onSend: () => void;
  connected: boolean;
}) {
  if (messages.length === 0 && !isStreaming) return null;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          {isStreaming ? "AI đang xử lý" : "Phân tích của AI"}
        </span>
        {isStreaming && (
          <Button variant="outline" size="sm" onClick={onStop}>
            <StopCircle /> Dừng
          </Button>
        )}
      </div>

      {messages.map((message, index) => {
        const isUser = message.role === "user";
        const isLastAssistant =
          message.role === "assistant" && index === messages.length - 1;
        const toolParts = message.parts.filter(isToolUIPart);
        const reasoningParts = message.parts.filter(
          (p) => p.type === "reasoning" && (p as { text?: string }).text?.trim()
        );
        const textParts = message.parts.filter((p) => p.type === "text");

        if (isUser) {
          const text = textParts
            .map((p) => (p as { text: string }).text)
            .join(" ");
          if (!text) return null;
          return (
            <div key={message.id} className="text-xs text-muted-foreground italic">
              ▶ {text}
            </div>
          );
        }

        return (
          <div key={message.id} className="space-y-2">
            {toolParts.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {toolParts.map((part) => (
                  <ToolChip key={part.toolCallId} part={part} />
                ))}
              </div>
            )}
            {reasoningParts.map((part, i) => {
              const r = part as { text: string; state?: "streaming" | "done" };
              return (
                <ReasoningBlock
                  key={i}
                  text={r.text}
                  done={r.state === "done" || !isStreaming}
                />
              );
            })}
            {textParts.map((part, i) => {
              const text = (part as { text: string }).text;
              if (!text) return null;
              return (
                <div key={i} className="rounded-xl border bg-background">
                  <Streamdown
                    className="sd-theme p-3 text-sm"
                    plugins={{ code }}
                    controls={false}
                    isAnimating={isLastAssistant && isStreaming}
                  >
                    {text}
                  </Streamdown>
                </div>
              );
            })}
          </div>
        );
      })}

      {/* Follow-up question to the agent */}
      <div className="flex items-end gap-2 rounded-xl border bg-card p-2 focus-within:ring-1 focus-within:ring-ring">
        <Textarea
          value={followUp}
          onChange={(e) => onFollowUpChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSend();
            }
          }}
          placeholder="Hỏi thêm AI…"
          aria-label="Hỏi thêm AI về giao dịch này"
          disabled={!connected || isStreaming}
          rows={1}
          className="max-h-32 min-h-0 flex-1 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
        />
        <Button
          size="sm"
          onClick={onSend}
          disabled={!followUp.trim() || isStreaming || !connected}
        >
          <Send /> Gửi
        </Button>
      </div>
    </div>
  );
}
