import path from "node:path";

/**
 * Vault library configuration (server environment only; no UI sets these).
 *
 *   LH_VAULT_DIR      A folder of Markdown notes to follow, mounted read-only.
 *                     Unset = the vault library is off and nothing scans.
 *   LH_VAULT_EXCLUDE  Comma-separated skip patterns that seed Settings →
 *                     Library until the learner saves a list of their own.
 */
export const VAULT_DIR: string | null = process.env.LH_VAULT_DIR
	? path.resolve(/* turbopackIgnore: true */ process.env.LH_VAULT_DIR)
	: null;

export const VAULT_EXCLUDE_RAW: string | undefined = process.env.LH_VAULT_EXCLUDE;
