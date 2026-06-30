export interface DuplicateContentIssue {
  text: string;
  firstLine: number;
  repeatedLine: number;
}

export interface KnowledgeContentQuality {
  duplicateIssues: DuplicateContentIssue[];
}

interface NormalizedLine {
  text: string;
  normalized: string;
  lineNumber: number;
}

const markdownPrefixPattern =
  /^\s{0,3}(?:#{1,6}\s+|>\s*)?(?:[-*+]\s+|\d+[.)]\s+)?(?:\[[ xX]\]\s+)?/u;

function normalizeMarkdownLine(rawLine: string): NormalizedLine | null {
  const text = rawLine.replace(markdownPrefixPattern, '').replace(/\s+/gu, ' ').trim();
  if (text.length === 0) {
    return null;
  }

  return {
    text,
    normalized: text.toLocaleLowerCase(),
    lineNumber: 0,
  };
}

export function analyzeKnowledgeContentQuality(markdown: string): KnowledgeContentQuality {
  const duplicateIssues: DuplicateContentIssue[] = [];
  const seenDuplicates = new Set<string>();
  let previous: NormalizedLine | null = null;

  markdown.split(/\r?\n/u).forEach((line, index) => {
    const normalizedLine = normalizeMarkdownLine(line);
    if (normalizedLine === null) {
      return;
    }

    const current = {
      ...normalizedLine,
      lineNumber: index + 1,
    };

    if (previous?.normalized === current.normalized && !seenDuplicates.has(current.normalized)) {
      seenDuplicates.add(current.normalized);
      duplicateIssues.push({
        text: current.text,
        firstLine: previous.lineNumber,
        repeatedLine: current.lineNumber,
      });
    }

    previous = current;
  });

  return { duplicateIssues };
}

export function hasBlockingContentQualityIssues(quality: KnowledgeContentQuality): boolean {
  return quality.duplicateIssues.length > 0;
}

export function duplicateContentIssueFingerprint(issue: DuplicateContentIssue): string {
  return `${issue.text}\u0000${String(issue.firstLine)}\u0000${String(issue.repeatedLine)}`;
}
