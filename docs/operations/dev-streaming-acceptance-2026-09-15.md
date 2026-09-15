# DEV streaming acceptance — 2026-09-15

Google Chrome Computer Use directly captured partial answer text and its later
growth before completion. This closes the incremental-rendering observation
left open in the [September 13 acceptance report](dev-browser-acceptance-2026-09-13.md).

## Verified release

The public DEV `/version.json`, GitHub `main`, and the deployment checkout all
identified `pbuchman/fishing-assistant` at
`ee98daddfb884f09772e62ab25a86fab728d1b2d` before testing. Its
[push CI](https://github.com/pbuchman/fishing-assistant/actions/runs/34810700450)
passed. The process verifier confirmed all five FA processes, their checkout
directories and port ownership. The FA PM2 and webhook systemd units were active.
Host checks used the configured Tailscale SSH destination. No local application
was used for browser acceptance.

## Direct browser observations

The restored session was checked against the requested existing account in the
read-only profile, which showed approved administrator access. Existing knowledge
pages were read in the administration interface without editing or publishing.
A page containing substantive guidance and a configured source link was selected
before asking a question.

Two user questions were submitted:

1. A longer answer completed successfully. Accessibility observations captured
   growth near the end, but that portion was below the screenshot viewport.
   Those images alone were insufficient to prove visible incremental rendering.
2. A shorter question about the same material was justified to keep growing text
   inside the viewport. Observation was started with the send action and continued
   through generation and completion, without modifying the DOM or response.

| Check                          | Result | Evidence                                                                                                                                                                                                                       |
| ------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Partial text before completion | Passed | At 09:56:23 UTC, the screenshot contained the first heading and an unfinished first sentence, with the answer still in draft state.                                                                                            |
| Later visible text growth      | Passed | At 09:56:24 UTC, the first paragraph was complete and the second paragraph was visibly growing. Successive screenshots showed additional words in the same viewport.                                                           |
| Generation completion          | Passed | At 09:56:41 UTC, the draft state was replaced by a saved answer, the source citation appeared and the normal composer returned.                                                                                                |
| Sources                        | Passed | The shorter answer displayed a citation whose destination matched the source URL read in the selected knowledge page. The longer answer displayed three citations.                                                             |
| Persistence                    | Passed | Reload restored both answers. Leaving the shorter conversation and selecting it from history restored its question, answer and citation.                                                                                       |
| Usage                          | Passed | Detailed Usage rows showed successful chat and query-embedding activity at both test times. The models were `deepseek/deepseek-v4-flash` and `qwen/qwen3-embedding-8b`. Multiple internal events came from each user question. |

Observation timestamps locate private evidence; they are not a latency benchmark.
No streaming defect was demonstrated and no runtime change was needed for this
acceptance check. This verifies the observed path and does not guarantee the
accuracy of every model statement or behavior across all providers and requests.

## Documentation verification

The initial full-gate attempt on macOS stopped in deployment-script tests because
`flock` was unavailable. Verification was moved to a separate Linux checkout,
outside the DEV deployment directory. The README and getting-started guide now
identify the Linux/file-locking prerequisite for the full quality gates.

## Screenshot and data handling

The README images are cropped, flattened PNG captures of the DEV interface
with example data substituted through Chrome DevTools after the live tests.
The profile, conversation history and knowledge titles are fictional; the
illustrative question and answer use general knowledge. Source labels contain
no external URLs. These temporary DOM changes did not write to the Knowledge
Base. They were separate from the unmodified streaming observation above and
are not evidence of retrieval or model output. Browser chrome and private
identifiers are excluded; the PNG files contain no inherited metadata.

Raw screenshots, observation records, conversation identifiers and account
details remain in a private operator directory outside Git. Only the two
reviewed screenshots belong in `docs/images/`; private streaming evidence is
not a public artifact.

The browser tests created conversation and model-usage records only. No knowledge
edits, publishing, sync, reindexing, migrations, migration-ledger changes,
embedding changes, authentication changes, GCP bootstrap, Terraform apply or
production operations were performed.
