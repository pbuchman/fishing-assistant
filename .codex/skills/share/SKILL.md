---
name: share
description: Use when the user asks to share, publish, host, or make HTML or Markdown content available at a public URL.
---

# Share

## Overview

Publish HTML or Markdown content to the FA shared-content GCS bucket and return a public URL.

Current target:

```text
Bucket:        replace-with-shared-content-bucket
Object prefix: share/
Base URL:      https://fishing-assistant.online/share/
```

Use the `share/` object prefix directly. Do not add `claude/`, `codex/`, or any other agent-specific namespace to the object path or public URL. Return the product-domain URL, not the `storage.googleapis.com` URL.

## Mode Selection

Choose the mode from explicit flags or user intent.

| Mode            | Trigger                                                                        | Public URL         |
| --------------- | ------------------------------------------------------------------------------ | ------------------ |
| Rich HTML       | `--html`, "share as HTML", "publish this visualization", existing `.html` file | `/share/<slug>`    |
| Styled Markdown | Default, "share this", "share as markdown", prose/report content               | `/share/<slug>`    |
| Raw Markdown    | `--raw-md`, "share raw markdown", "upload the markdown file"                   | `/share/<slug>.md` |

Do not use this for private storage, secrets, internal artifacts, or anything that should not be world-readable.

## Workflow

### 1. Confirm Infrastructure

The target bucket and IAM are declared in `terraform/gcp-data-plane`. If upload commands report that the bucket does not exist or access is denied, stop and tell the user the GCP data-plane Terraform needs to be applied before sharing will work.

If the shell may have unrelated Google settings, prefer the FA admin identity:

```bash
GOOGLE_APPLICATION_CREDENTIALS=$HOME/.config/gcloud/fa-admin-key.json \
GOOGLE_CLOUD_PROJECT="$FA_GCP_PROJECT_ID" \
GCLOUD_PROJECT="$FA_GCP_PROJECT_ID" \
gsutil ls -b gs://replace-with-shared-content-bucket 2>&1
```

### 2. Prepare Content

**Rich HTML mode**

1. If the user points to an existing self-contained HTML file, use it directly.
2. Otherwise create a self-contained HTML page first.
3. Keep CSS inline and avoid external dependencies unless the user provided them.

**Styled Markdown mode**

1. Take the Markdown content.
2. Convert it to HTML.
3. Wrap it in the GitHub-style template below.

**Raw Markdown mode**

1. Use the Markdown as-is.
2. Upload it with `text/markdown`.

### 3. Generate A Slug

Create a descriptive kebab-case slug.

Examples:

- `deployment-runbook`
- `rag-results-analysis`
- `knowledge-sync-map`

Rules:

- lowercase
- kebab-case
- 2 to 5 words
- no timestamps unless the content is date-specific

### 4. Write To A Temp File

If using an existing file, copy it:

```bash
cp <source-file> /tmp/fa-share-<slug>.<ext>
```

If generating content, write it to:

```bash
/tmp/fa-share-<slug>.html
/tmp/fa-share-<slug>.md
```

### 5. Check For Collisions

For Rich HTML and Styled Markdown, the object key is extensionless:

```bash
gsutil ls gs://replace-with-shared-content-bucket/share/<slug> 2>&1
```

For Raw Markdown, the object key keeps the `.md` suffix:

```bash
gsutil ls gs://replace-with-shared-content-bucket/share/<slug>.md 2>&1
```

- If the object exists, append `-2`, `-3`, and retry.
- If `gsutil` reports no match, proceed.
- Only overwrite an existing object if the user explicitly asked to update that exact shared document.

### 6. Upload

HTML:

```bash
gsutil -h "Cache-Control:public, max-age=3600" \
  -h "Content-Type:text/html; charset=utf-8" \
  cp /tmp/fa-share-<slug>.html \
  gs://replace-with-shared-content-bucket/share/<slug>
```

Raw Markdown:

```bash
gsutil -h "Cache-Control:public, max-age=3600" \
  -h "Content-Type:text/markdown; charset=utf-8" \
  cp /tmp/fa-share-<slug>.md \
  gs://replace-with-shared-content-bucket/share/<slug>.md
```

### 7. Verify

Verify object upload:

HTML:

```bash
gsutil stat gs://replace-with-shared-content-bucket/share/<slug> 2>&1
```

Raw Markdown:

```bash
gsutil stat gs://replace-with-shared-content-bucket/share/<slug>.md 2>&1
```

Verify public URL:

HTML:

```bash
curl -s -o /dev/null -w '%{http_code}' \
  https://fishing-assistant.online/share/<slug>
```

Raw Markdown:

```bash
curl -s -o /dev/null -w '%{http_code}' \
  https://fishing-assistant.online/share/<slug>.md
```

- `200` means the URL is live.
- `403` usually means public bucket IAM has not been applied.
- `404` after a successful upload usually means the path, slug, or extension differs from the object name.

### 8. Clean Up And Report

```bash
rm /tmp/fa-share-<slug>.<ext>
```

Return:

```text
Published: https://fishing-assistant.online/share/<slug>
```

For Raw Markdown, return:

```text
Published: https://fishing-assistant.online/share/<slug>.md
```

## GitHub-Style Template

Use this for styled Markdown uploads after converting the Markdown body to HTML.

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{{TITLE}}</title>
    <style>
      :root {
        --color-fg: #1f2328;
        --color-bg: #ffffff;
        --color-border: #d0d7de;
        --color-link: #0969da;
        --color-code-bg: #f6f8fa;
        --color-blockquote-fg: #656d76;
      }
      @media (prefers-color-scheme: dark) {
        :root {
          --color-fg: #e6edf3;
          --color-bg: #0d1117;
          --color-border: #30363d;
          --color-link: #58a6ff;
          --color-code-bg: #161b22;
          --color-blockquote-fg: #8b949e;
        }
      }
      * {
        box-sizing: border-box;
      }
      body {
        max-width: 800px;
        margin: 0 auto;
        padding: 2rem 1.5rem;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
        font-size: 16px;
        line-height: 1.6;
        color: var(--color-fg);
        background: var(--color-bg);
      }
      h1,
      h2 {
        padding-bottom: 0.3em;
        border-bottom: 1px solid var(--color-border);
      }
      a {
        color: var(--color-link);
        text-decoration: none;
      }
      a:hover {
        text-decoration: underline;
      }
      pre {
        background: var(--color-code-bg);
        border-radius: 6px;
        padding: 16px;
        overflow-x: auto;
      }
      code {
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 85%;
      }
      :not(pre) > code {
        background: var(--color-code-bg);
        border-radius: 6px;
        padding: 0.2em 0.4em;
      }
      table {
        border-collapse: collapse;
        width: 100%;
      }
      th,
      td {
        border: 1px solid var(--color-border);
        padding: 6px 13px;
      }
      blockquote {
        margin: 0;
        padding: 0 1em;
        color: var(--color-blockquote-fg);
        border-left: 0.25em solid var(--color-border);
      }
      img {
        max-width: 100%;
        height: auto;
      }
    </style>
  </head>
  <body>
    {{CONTENT}}
  </body>
</html>
```

## Failure Handling

- If `gsutil` is missing, say so and stop.
- If upload succeeds but URL verification returns non-`200`, report both the `gs://` object path and HTTP status.
- If the source HTML is not self-contained, fix it before upload when feasible.
