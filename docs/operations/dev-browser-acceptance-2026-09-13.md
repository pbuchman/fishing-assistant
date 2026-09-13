# DEV browser acceptance — 2026-09-13

Real Google Chrome Computer Use checks confirmed login, existing knowledge,
one grounded chat answer, a working source link, conversation persistence and
visible model usage. Incremental answer text was not captured between browser
observations, so this run does **not** establish full streaming acceptance.

## Release and handoff verification

- The initially clean local checkout was fetched and a new verification branch
  was created from current `origin/main`. No local application was started.
- Public `https://dev.fishing-assistant.online/version.json`, the remote deploy
  checkout and the recorded active release all identified
  `pbuchman/fishing-assistant` at
  `6e1e7219fb77c597ee64eb70f2fed9468aebc353`.
- [PR #4](https://github.com/pbuchman/fishing-assistant/pull/4) was merged at that
  SHA. Its [push CI](https://github.com/pbuchman/fishing-assistant/actions/runs/34711606398)
  completed successfully.
- [PR #5](https://github.com/pbuchman/fishing-assistant/pull/5) was still open,
  ready for review, with successful CI. Its documentation was not assumed to be
  part of the deployed release.
- Remote checks were repeated over the full Tailscale hostname because the
  workstation's existing SSH alias resolved to a LAN address. No SSH
  configuration was changed.
- The checked-in process verifier confirmed all five FA processes, deployment
  directories, disabled watch mode and ownership of the expected ports in the
  dedicated FA PM2 pool. FA PM2 and webhook systemd units were active and
  enabled; the former FKA PM2 unit was inactive and disabled.
- Root, app, edge health and four public API health endpoints returned HTTP 200. Chat health included a successful Firestore check. A public internal API
  probe returned 404. These checks supplement the browser results below.
- GitHub's push webhook was active. Historical redelivery responses included
  HTTP 202; the durable queue contained a succeeded job with one attempt at the
  current SHA. This is consistent with the handed-off deduplication result;
  no delivery was replayed and no deployment was triggered in this run.
- Comparing the retained pre-cutover snapshot at its actual dated private
  location succeeded: all knowledge node, page and chunk IDs and content hashes
  matched. The unversioned example snapshot path in the runbook did not exist.

## Browser results

All interface actions used Computer Use in Google Chrome against deployed DEV.
The single submitted question was sent at 09:25 UTC (11:25 Europe/Warsaw).

| Check                              | Result          | Directly observed evidence                                                                                                                                                                                                                                     |
| ---------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Existing-account login             | Passed          | Logged out of the restored session, opened the assistant, selected Google on Auth0, and returned through the application callback. The read-only profile confirmed the requested existing account, approved status and administrator role.                     |
| Administrative access              | Passed          | Administration and the knowledge list opened successfully.                                                                                                                                                                                                     |
| Existing knowledge                 | Passed          | Existing pages and current publication status were visible. Opened existing pages and read one with a configured source URL, without editing or saving.                                                                                                        |
| One grounded answer                | Passed          | Submitted one question about a fact already checked in the selected page. The completed answer agreed with that fact.                                                                                                                                          |
| Generation progress and completion | Passed          | The browser showed a draft/searching state and a stop control, followed by the completed answer and normal composer.                                                                                                                                           |
| Incremental answer text            | Not established | The short answer completed between observations. No partial answer text was captured. Progress indicators alone do not prove progressive text rendering.                                                                                                       |
| Source link                        | Passed          | The answer's source matched the selected page's configured URL. Clicking it opened the expected external source page in a new Chrome tab.                                                                                                                      |
| Conversation history               | Passed          | The conversation appeared in history. Reload restored the question, answer and citation; leaving the conversation and selecting it from history also restored them.                                                                                            |
| Usage                              | Passed          | Usage gained successful events at the test time for the verified account. Detailed rows showed `deepseek/deepseek-v4-flash` and the query embedding model `qwen/qwen3-embedding-8b`. Multiple internal usage events came from the one submitted user question. |

## Limitations and remaining check

No application failure was demonstrated in the completed checks. The Auth0
login screen retained its legacy application display name; login still
succeeded and the deployed repository identity was independently verified.

The remaining acceptance check is direct browser observation of incremental
answer text. No additional model request was submitted solely to replace the
missing observation. This report must not be read as a full streaming pass.

The private operator record retains the conversation URL and test timing for
follow-up. Account details, conversation identifiers, knowledge titles or text,
source URLs and browser screenshots are omitted from this public report.

No application code, live configuration, authorization, knowledge, migration
ledger, embedding configuration or production environment was changed. No
restart, deployment, migration, bootstrap, Terraform apply, publication, sync
or reindex operation was performed.
