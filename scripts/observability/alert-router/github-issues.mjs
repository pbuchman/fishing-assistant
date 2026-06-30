const githubApiBaseUrl = 'https://api.github.com';

/**
 * @param {Response} response
 * @returns {Promise<unknown>}
 */
async function readJsonResponse(response) {
  const text = await response.text();
  if (text.length === 0) {
    return {};
  }

  return JSON.parse(text);
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function asRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? /** @type {Record<string, unknown>} */ (value)
    : {};
}

/**
 * @param {{ repository: string; token: string; fetchImpl?: typeof fetch }} input
 * @returns {{ createIssue(input: { title: string; body: string; labels?: string[] }): Promise<{ number: number; html_url?: string }>; commentOnIssue(input: { issueNumber: number; body: string }): Promise<{ html_url?: string }> }}
 */
export function createGitHubIssuesClient(input) {
  const fetchImpl = input.fetchImpl ?? fetch;

  /**
   * @param {string} path
   * @param {unknown} body
   * @returns {Promise<Record<string, unknown>>}
   */
  async function request(path, body) {
    const response = await fetchImpl(`${githubApiBaseUrl}/repos/${input.repository}${path}`, {
      method: 'POST',
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${input.token}`,
        'content-type': 'application/json',
        'x-github-api-version': '2022-11-28',
      },
      body: JSON.stringify(body),
    });

    const payload = asRecord(await readJsonResponse(response));
    if (!response.ok) {
      const message =
        typeof payload['message'] === 'string' ? payload['message'] : response.statusText;
      throw new Error(`GitHub API request failed: ${response.status} ${message}`);
    }

    return payload;
  }

  return {
    async createIssue(issue) {
      const payload = await request('/issues', issue);
      /** @type {{ number: number; html_url?: string }} */
      const result = {
        number: Number(payload['number']),
      };
      if (typeof payload['html_url'] === 'string') {
        result.html_url = payload['html_url'];
      }
      return result;
    },

    async commentOnIssue(comment) {
      const payload = await request(`/issues/${String(comment.issueNumber)}/comments`, {
        body: comment.body,
      });
      if (typeof payload['html_url'] === 'string') {
        return { html_url: payload['html_url'] };
      }
      return {};
    },
  };
}
