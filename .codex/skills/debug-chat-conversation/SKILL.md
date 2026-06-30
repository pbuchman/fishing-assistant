---
name: debug-chat-conversation
description: Use when a Fishing Assistant user shares an FA chat conversation URL, hash-routed /app#/chat/<conversationId> link, or raw conversation UUID and asks Codex to debug, investigate, or explain unexpected chat behavior; maintain this skill over time with proven evidence-backed debugging methods and missing evidence sources.
---

# Debug Chat Conversation

## Core Rule

Answer with evidence. Do not speculate. Every conclusion must cite concrete
Firestore data, usage records, logs, or the explicit absence of one of those
evidence sources.

## Workflow

1. Read the user's pasted chat URL or raw conversation UUID and their short
   description of what went wrong.
2. Do not fetch the hash-routed SPA URL as evidence. It is only a client route
   and does not contain the conversation facts.
3. Run the canonical read-only helper:

```bash
node .codex/skills/debug-chat-conversation/scripts/fetch-conversation.mjs '<chat-url-or-conversation-id>'
```

4. Use the helper output as primary evidence. It requires
   `FA_GCP_ADMIN_KEY_FILE` so evidence provenance stays on the project admin
   credential surface. By default it redacts raw message content, retrieval
   queries, user IDs, conversation titles, and raw missing-information text. It
   prints conversation metadata, message IDs, roles, timestamps, stream status,
   public error text, prompt versions, retrieval source statuses, evidence
   titles/scores, citations, missing-information counts, and best-effort usage
   events when present.
5. If runtime logs are needed after Firestore and usage evidence is gathered,
   use `.codex/skills/grafana-logs/SKILL.md` to query central Grafana Cloud
   Loki logs for the relevant environment, services, IDs, and time window. If
   Loki logs are unavailable, say exactly which log source is missing and why
   that limits the conclusion.
6. Use `--include-content` only when exact chat text or retrieval quotes are
   required to debug the failure. Do not echo raw user content, user IDs, or
   private Knowledge Base text in the final answer unless it is necessary
   evidence; quote the smallest useful excerpt.
7. Explain the likely failure chain only where each step is supported by the
   gathered evidence.

## Output Contract

Return:

- `Evidence`: concise facts with IDs/timestamps/source names.
- `Conclusion`: what the evidence supports.
- `Missing evidence`: logs, usage events, request IDs, or Firestore fields that
  were unavailable.
- `Fix or next step`: the smallest repo or operational action justified by the
  evidence.

## Self-Improvement

When an investigation reveals a repeatable debugging method, a Firestore field
worth printing, a useful log query, or a missing evidence source, update this
skill and the helper in the same branch when it belongs to the current fix, or
open a follow-up PR when it is outside the current scope.
