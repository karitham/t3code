import type * as AcpSchema from "effect-acp/compat";
import { describe, expect, it } from "vite-plus/test";

import { extractGenericSubagentSessionEvent } from "./genericAcp.ts";

const notification = (
  update: Record<string, unknown>,
  sessionId = "root-session",
): AcpSchema.SessionNotification =>
  ({ sessionId, update }) as unknown as AcpSchema.SessionNotification;

const subagent = (state: Record<string, unknown>, title?: string | null) =>
  notification({
    sessionUpdate: "_t3_unknown",
    originalSessionUpdate: "subagent_update",
    raw: { sessionId: "child-session", ...(title === undefined ? {} : { title }), state },
  });

describe("generic ACP v2 subagent updates", () => {
  it("reads a running child with its display title", () => {
    expect(extractGenericSubagentSessionEvent(subagent({ state: "running" }, "Research"))).toEqual({
      type: "state",
      childSessionId: "child-session",
      parentSessionId: "root-session",
      title: "Research",
      status: "running",
      result: null,
    });
  });

  it("maps a normal idle child to completed", () => {
    const event = extractGenericSubagentSessionEvent(
      subagent({ state: "idle", stopReason: "end_turn" }),
    );
    if (event?.type !== "state") throw new Error("expected a child state event");
    expect(event.status).toBe("completed");
    expect(event.title).toBeNull();
  });

  it("reads a standard inter-session message as child output", () => {
    expect(
      extractGenericSubagentSessionEvent(
        notification({
          sessionUpdate: "_t3_unknown",
          originalSessionUpdate: "session_message",
          raw: {
            messageId: "m1",
            senderSessionId: "child-session",
            recipientSessionId: "root-session",
            content: [{ type: "text", text: "hi from child" }],
          },
        }),
      ),
    ).toEqual({
      type: "message",
      childSessionId: "child-session",
      parentSessionId: "root-session",
      messageId: "m1",
      text: "hi from child",
    });
  });

  it("reads a child's own state_update so the child can be terminalized", () => {
    expect(
      extractGenericSubagentSessionEvent(
        notification(
          { sessionUpdate: "state_update", state: "idle", stopReason: "end_turn" },
          "child-session",
        ),
      ),
    ).toEqual({
      type: "state",
      childSessionId: "child-session",
      parentSessionId: null,
      title: undefined,
      status: "completed",
      result: null,
    });
  });
});
