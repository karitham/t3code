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

const decodeSessionMessage = Schema.decodeUnknownOption(
  Schema.Struct({
    messageId: Schema.String,
    senderSessionId: Schema.String,
    recipientSessionId: Schema.optionalKey(Schema.NullOr(Schema.String)),
    content: Schema.Array(
      Schema.Struct({ type: Schema.String, text: Schema.optionalKey(Schema.String) }),
    ),
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
  if (original === "session_message") {
    const message = decodeSessionMessage("raw" in update ? update.raw : update);
    if (Option.isNone(message)) return;
    const text = message.value.content
      .flatMap((block) => (block.type === "text" && block.text !== undefined ? [block.text] : []))
      .join("\n");
    return {
      type: "message",
      childSessionId: message.value.senderSessionId,
      parentSessionId: message.value.recipientSessionId ?? null,
      messageId: message.value.messageId,
      text,
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
