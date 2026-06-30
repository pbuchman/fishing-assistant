import { execFileSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

describe('Hetzner deploy host key helpers', () => {
  it('parses ssh-keygen fingerprints while the deploy script excludes spaces from IFS', () => {
    const output = execFileSync(
      'bash',
      [
        '-c',
        [
          'source scripts/hetzner/github-actions-deploy.sh',
          "IFS=$'\\n\\t'",
          "parse_ssh_key_fingerprint '256 SHA256:abc123 root@example (ED25519)'",
        ].join('\n'),
      ],
      { encoding: 'utf8' }
    );

    expect(output.trim()).toBe('SHA256:abc123');
  });
});
