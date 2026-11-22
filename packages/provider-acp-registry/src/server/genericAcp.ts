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

/**
 * ACP v2's standard `subagent_update` has no provider-specific tool shape. The
 * generic client keeps unknown updates under `_t3_unknown` with the original
 * name and raw frame intact, so this reads that frame without needing a new
 * provider flavor for every agent that follows the protocol.
 */
export function extractGenericSubagentSessionEvent(
  notification: AcpSchema.SessionNotification,
): AcpSubagentSessionEvent | undefined {
  const update = notification.update;
  const original =
    update.sessionUpdate === "_t3_unknown" ? update.originalSessionUpdate : update.sessionUpdate;
  if (original !== "subagent_update") return;
  const child = decodeChildState("raw" in update ? update.raw : update);
  if (Option.isNone(child)) return;
  const { sessionId, title, state } = child.value;
  const unfinishedMessage = acpUnfinishedStopMessage(state.stopReason);
  return {
    type: "state",
    childSessionId: sessionId,
    parentSessionId: notification.sessionId,
    title: title ?? null,
    status:
      state.state === "running" || state.state === "requires_action"
        ? "running"
        : state.stopReason === "error" || unfinishedMessage !== undefined
          ? "failed"
          : state.stopReason === "cancelled" || state.state === "unknown"
            ? "cancelled"
            : "completed",
    result: state.error?.message ?? unfinishedMessage ?? null,
  };
}
