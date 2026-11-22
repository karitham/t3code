import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type * as AcpSchema from "effect-acp/compat";
import {
  acpUnfinishedStopMessage,
  type AcpSubagentSessionEvent,
} from "@t3tools/provider-acp/server/adapter";

const decodeChildState = Schema.decodeUnknownOption(
  Schema.Struct({
    sessionId: Schema.String,
    title: Schema.optionalKey(Schema.NullOr(Schema.String)),
    state: Schema.Struct({
      state: Schema.String,
      stopReason: Schema.optionalKey(Schema.NullOr(Schema.String)),
      error: Schema.optionalKey(Schema.NullOr(Schema.Struct({ message: Schema.String }))),
    }),
  }),
);

const decodeRootState = Schema.decodeUnknownOption(
  Schema.Struct({
    state: Schema.String,
    stopReason: Schema.optionalKey(Schema.NullOr(Schema.String)),
    error: Schema.optionalKey(Schema.NullOr(Schema.Struct({ message: Schema.String }))),
  }),
);

const stateStatus = (state: {
  readonly state: string;
  readonly stopReason?: string | null;
  readonly error?: { readonly message: string } | null;
}) => {
  const unfinishedMessage = acpUnfinishedStopMessage(state.stopReason);
  return {
    status:
      state.state === "running" || state.state === "requires_action"
        ? ("running" as const)
        : state.stopReason === "error" || unfinishedMessage !== undefined
          ? ("failed" as const)
          : state.stopReason === "cancelled" || state.state === "unknown"
            ? ("cancelled" as const)
            : ("completed" as const),
    result: state.error?.message ?? unfinishedMessage ?? null,
  };
};

/**
 * ACP v2 announces a child with `subagent_update` and then reports its phase on
 * the child session with `state_update`. The generic client keeps unknown
 * updates under `_t3_unknown` with the raw frame intact, so this reads both
 * without requiring a provider-specific flavor for every ACP v2 agent.
 */
export function extractGenericSubagentSessionEvent(
  notification: AcpSchema.SessionNotification,
): AcpSubagentSessionEvent | undefined {
  const update = notification.update;
  const original =
    update.sessionUpdate === "_t3_unknown" ? update.originalSessionUpdate : update.sessionUpdate;
  if (original === "state_update") {
    const state = decodeRootState(update);
    if (Option.isNone(state)) return;
    const { status, result } = stateStatus(state.value);
    return {
      type: "state",
      childSessionId: notification.sessionId,
      parentSessionId: null,
      title: undefined,
      status,
      result,
    };
  }
  if (original !== "subagent_update") return;
  const child = decodeChildState("raw" in update ? update.raw : update);
  if (Option.isNone(child)) return;
  const { sessionId, title, state } = child.value;
  const { status, result } = stateStatus(state);
  return {
    type: "state",
    childSessionId: sessionId,
    parentSessionId: notification.sessionId,
    title: title ?? null,
    status,
    result,
  };
}

/**
 * Agents that deliver child replies as mail still stream those letters into
 * the editor as user messages. They are not editor input and must not open a
 * new turn; the child's own ACP frames carry the answer to its subagent view.
 */
export function shouldIgnoreGenericNotification(
  notification: AcpSchema.SessionNotification,
  ignoreWorkState = false,
): boolean {
  const update = notification.update as unknown as Record<string, unknown>;
  const original =
    update.sessionUpdate === "_t3_unknown" ? update.originalSessionUpdate : update.sessionUpdate;
  // Albedo's root state_update is a background snapshot, not new work: its
  // prompt response settles the turn and its subagent_update frames announce
  // children. Following the snapshot reopens the parent to clean up children.
  if (ignoreWorkState && original === "state_update") return true;
  if (original !== "user_message" && original !== "user_message_chunk") return false;
  const content = update.content;
  const text =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content
            .map((block) =>
              typeof block === "object" && block !== null && "text" in block
                ? String((block as { text?: unknown }).text ?? "")
                : "",
            )
            .join("\n")
        : typeof content === "object" && content !== null && "text" in content
          ? String((content as { text?: unknown }).text ?? "")
          : "";
  return text.includes("<mail");
}
