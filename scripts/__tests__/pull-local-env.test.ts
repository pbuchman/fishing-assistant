import { describe, expect, it } from 'vitest';

import {
  formatEnvValue,
  githubVariableBindingsForLocalEnv,
  renderLocalEnv,
  secretBindingsForLocalEnv,
} from '../pull-local-env.mjs';

const template = `# DEV profile
FA_ENVIRONMENT=dev
FA_GCP_PROJECT_ID=example-fa-project
FA_GCP_ADMIN_KEY_FILE=replace-with-local-fa-admin-key-path
FA_AUTH0_DOMAIN=replace-with-auth0-domain
FA_AUTH0_CLIENT_ID=replace-with-auth0-spa-client-id
FA_AUTH0_AUDIENCE=replace-with-auth0-api-audience
FA_AUTH0_ISSUER=https://replace-with-auth0-domain/
FA_AUTH0_JWKS_URI=https://replace-with-auth0-domain/.well-known/jwks.json
FA_BOOTSTRAP_ADMIN_EMAILS=admin@example.com
FA_SIGNUP_ALLOWED_EMAIL_PATTERN=^[^@\\s]+@example\\.com$
FA_INTERNAL_AUTH_TOKEN=replace-with-local-generated-token
FA_OPENROUTER_APP_API_KEY=
FA_MINIMAX_APP_API_KEY=
FA_OPENAI_APP_API_KEY=
`;

describe('local env pull rendering', () => {
  it('maps dev-specific Auth0 GitHub variables into local runtime Auth0 keys', () => {
    expect(githubVariableBindingsForLocalEnv()).toEqual([
      { sourceName: 'FA_DEV_AUTH0_DOMAIN', targetName: 'FA_AUTH0_DOMAIN' },
      { sourceName: 'FA_DEV_AUTH0_CLIENT_ID', targetName: 'FA_AUTH0_CLIENT_ID' },
      { sourceName: 'FA_DEV_AUTH0_AUDIENCE', targetName: 'FA_AUTH0_AUDIENCE' },
    ]);
  });

  it('maps dev provider Secret Manager values into stable runtime keys', () => {
    expect(secretBindingsForLocalEnv()).toContainEqual({
      sourceName: 'FA_DEV_OPENROUTER_APP_API_KEY',
      targetName: 'FA_OPENROUTER_APP_API_KEY',
      required: true,
    });
    expect(secretBindingsForLocalEnv()).toContainEqual({
      sourceName: 'FA_DEV_MINIMAX_APP_API_KEY',
      targetName: 'FA_MINIMAX_APP_API_KEY',
      required: true,
    });
  });

  it('quotes env values that contain spaces or shell-sensitive characters', () => {
    expect(formatEnvValue('simple-value')).toBe('simple-value');
    expect(formatEnvValue('value with spaces')).toBe('"value with spaces"');
  });

  it('fills local env values from GitHub variables and Secret Manager values', () => {
    const rendered = renderLocalEnv(template, {
      homeExpression: '$HOME',
      githubVariables: new Map([
        ['FA_AUTH0_DOMAIN', 'fa-dev.example.auth0.com'],
        ['FA_AUTH0_CLIENT_ID', 'spa-client'],
        ['FA_AUTH0_AUDIENCE', 'https://api.dev.fishing-assistant.online'],
      ]),
      secretValues: new Map([
        ['FA_AUTH0_ISSUER', 'https://fa-dev.example.auth0.com/'],
        ['FA_AUTH0_JWKS_URI', 'https://fa-dev.example.auth0.com/.well-known/jwks.json'],
        ['FA_BOOTSTRAP_ADMIN_EMAILS', 'operator@fishing-assistant.online'],
        ['FA_INTERNAL_AUTH_TOKEN', 'internal-token'],
        ['FA_DEV_OPENROUTER_APP_API_KEY', 'openrouter-dev-key'],
        ['FA_DEV_MINIMAX_APP_API_KEY', 'minimax-dev-key'],
      ]),
    });

    expect(rendered).toContain('FA_GCP_ADMIN_KEY_FILE=$HOME/.config/gcloud/fa-admin-key.json');
    expect(rendered).toContain('FA_AUTH0_DOMAIN=fa-dev.example.auth0.com');
    expect(rendered).toContain('FA_AUTH0_CLIENT_ID=spa-client');
    expect(rendered).toContain('FA_INTERNAL_AUTH_TOKEN=internal-token');
    expect(rendered).toContain('FA_OPENROUTER_APP_API_KEY=openrouter-dev-key');
    expect(rendered).toContain('FA_MINIMAX_APP_API_KEY=minimax-dev-key');
    expect(rendered).not.toContain('replace-with-auth0-domain');
    expect(rendered).not.toContain('replace-with-local-generated-token');
  });
});
