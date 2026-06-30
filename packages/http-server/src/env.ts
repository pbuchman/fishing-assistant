export function findMissingEnv(
  required: readonly string[],
  env: NodeJS.ProcessEnv = process.env
): string[] {
  return required.filter((name) => env[name] === undefined || env[name] === '');
}

export function validateRequiredEnv(
  required: readonly string[],
  env: NodeJS.ProcessEnv = process.env
): void {
  const missing = findMissingEnv(required, env);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}
