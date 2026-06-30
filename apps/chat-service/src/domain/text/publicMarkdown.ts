function stripMarkdownUrlTargets(markdown: string): string {
  return markdown
    .replace(/!\[[^\]]*]\((?:https?:\/\/|www\.)[^)]+\)/gi, '[image hidden]')
    .replace(/\[([^\]]+)]\((?:https?:\/\/|www\.)[^)]+\)/gi, '$1');
}

function redactBareUrls(markdown: string): string {
  return markdown.replace(/\b(?:https?:\/\/|www\.)[^\s<>(){}"']+/gi, '[link hidden]');
}

function redactImageFilenames(markdown: string): string {
  return markdown.replace(/`?\b[\w.-]{1,160}\.(?:png|jpe?g|webp|gif|svg)\b`?/gi, '[image hidden]');
}

function redactFilenames(markdown: string): string {
  return markdown.replace(
    /`?\b[\w-]{2,160}\.(?!(?:com|net|org|io|co|gov|edu|uk|us|de|pl|ai|app|info|biz|me|xyz|local|localhost|internal|invalid)\b)[a-z]{2,8}\b(?!\.[A-Za-z0-9-])`?/gi,
    '[file hidden]'
  );
}

function stripProviderControlArtifacts(markdown: string): string {
  const controlMarker = /(?:\]<\]minimax\[>\[|<\/?tool_call\b|<\/?invoke\b|<\/?query\b)/iu;
  const markerIndex = markdown.search(controlMarker);
  if (markerIndex < 0) {
    return markdown;
  }

  return markdown.slice(0, markerIndex);
}

export function sanitizePublicMarkdown(markdown: string): string {
  return redactFilenames(
    redactImageFilenames(
      redactBareUrls(stripMarkdownUrlTargets(stripProviderControlArtifacts(markdown)))
    )
  )
    .replace(/[ \t]+([.,;:!?])/g, '$1')
    .replace(/\[link hidden]\s*([.,;:!?])?/g, '[link hidden]')
    .replace(/\[link hidden](?=\S)/g, '[link hidden] ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
