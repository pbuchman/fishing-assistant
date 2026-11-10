/** @typedef {{user?: {login?: string, id?: number, type?: string}, state?: string, draft?: boolean, base?: {ref?: string, repo?: {full_name?: string}}, head?: {sha?: string, repo?: {full_name?: string}}}} PullRequest */
/** @param {{pr: PullRequest, repository: string, expectedSha: string, updateType: string, dependencyNames: string, files: {filename: string, status: string}[]}} input */
export function eligiblePatch(input) {
  const { pr, repository, expectedSha, updateType, dependencyNames, files } = input;
  return (
    pr.user?.login === 'dependabot[bot]' &&
    pr.user.id === 49699333 &&
    pr.user.type === 'Bot' &&
    pr.state === 'open' &&
    pr.draft === false &&
    pr.base?.ref === 'main' &&
    pr.base.repo?.full_name === repository &&
    pr.head?.repo?.full_name === repository &&
    /^[a-f0-9]{40}$/.test(expectedSha) &&
    pr.head.sha === expectedSha &&
    updateType === 'version-update:semver-patch' &&
    dependencyNames.trim().length > 0 &&
    files.length > 0 &&
    files.every(
      ({ filename, status }) =>
        status === 'modified' &&
        /^(?:pnpm-lock\.yaml|package\.json|(?:apps|packages)\/[^/]+\/package\.json|migrations\/package\.json)$/.test(
          filename
        )
    )
  );
}

/** @param {string} before @param {string} after */
export function isPatchVersion(before, after) {
  const pattern = /^([~^]?)(\d+)\.(\d+)\.(\d+)$/;
  const a = pattern.exec(before),
    b = pattern.exec(after);
  return (
    !!a && !!b && a[1] === b[1] && a[2] === b[2] && a[3] === b[3] && Number(b[4]) > Number(a[4])
  );
}

/** Only dependency version edits are allowed; scripts/config/new dependency entries require review.
 * @param {Record<string, unknown>} before @param {Record<string, unknown>} after
 */
export function manifestPatchOnly(before, after) {
  const allowed = new Set([
    'dependencies',
    'devDependencies',
    'optionalDependencies',
    'peerDependencies',
  ]);
  if (JSON.stringify(Object.keys(before).sort()) !== JSON.stringify(Object.keys(after).sort()))
    return false;
  for (const key of Object.keys(before)) {
    if (JSON.stringify(before[key]) === JSON.stringify(after[key])) continue;
    if (!allowed.has(key)) return false;
    const a = /** @type {Record<string, string>} */ (before[key]);
    const b = /** @type {Record<string, string>} */ (after[key]);
    if (!a || !b || JSON.stringify(Object.keys(a).sort()) !== JSON.stringify(Object.keys(b).sort()))
      return false;
    if (
      !Object.keys(a).every(
        (name) => a[name] === b[name] || isPatchVersion(a[name] ?? '', b[name] ?? '')
      )
    )
      return false;
  }
  return true;
}
