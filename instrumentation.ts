/** Plugins use the documented per-server initialization hook. A plugin failure
 * must not prevent access to existing learning data or teaching/practice.
 * The vault library follower starts here too, only when LH_VAULT_DIR is set. */
export async function register() {
	if (process.env.NEXT_RUNTIME === "nodejs") {
		const { initializePlugins } = await import("./src/server/plugins.ts");
		try { await initializePlugins(); }
		catch (error) { console.error("[plugins] Initialization failed; plugin management will report the error:", error); }
		if (process.env.LH_VAULT_DIR) {
			try {
				const { startVaultFollower } = await import("./src/server/library.ts");
				startVaultFollower();
			} catch (error) { console.error("[vault] Could not start the vault follower:", error); }
		}
	}
}
