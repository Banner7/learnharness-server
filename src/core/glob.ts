/** Glob matching without backtracking. `*` and `?` stay inside one path
 *  segment, `**` crosses folders, and `**` + `/` also matches zero folders.
 *  Everything else is literal. Patterns may come from the model (find/grep)
 *  or a saved skip list, so matching is a set-of-positions walk: time is
 *  O(tokens × path length) whatever the pattern, never exponential. */

type Token = { kind: "lit"; char: string } | { kind: "one" | "star" | "any" | "dirs" };

function tokenize(glob: string): Token[] {
	const out: Token[] = [];
	for (let i = 0; i < glob.length; i++) {
		const c = glob[i]!;
		if (c === "*" && glob[i + 1] === "*") {
			if (glob[i + 2] === "/") { out.push({ kind: "dirs" }); i += 2; } else { out.push({ kind: "any" }); i += 1; }
		} else if (c === "*") out.push({ kind: "star" });
		else if (c === "?") out.push({ kind: "one" });
		else out.push({ kind: "lit", char: c });
	}
	return out;
}

/** `prefix`: the glob must match a leading folder path (ending right before
 *  a "/"); otherwise the whole path must match. */
export function globMatcher(glob: string, prefix = false): (path: string) => boolean {
	const tokens = tokenize(glob);
	return (path) => {
		const n = path.length;
		// cur[j]: the tokens so far can match path[0..j).
		let cur = new Uint8Array(n + 1);
		cur[0] = 1;
		for (const token of tokens) {
			const next = new Uint8Array(n + 1);
			let seen = false; // some cur[i] with i < j
			for (let j = 0; j <= n; j++) {
				switch (token.kind) {
					case "lit": if (cur[j] && path[j] === token.char) next[j + 1] = 1; break;
					case "one": if (cur[j] && j < n && path[j] !== "/") next[j + 1] = 1; break;
					case "star": if (cur[j] || (j > 0 && next[j - 1] && path[j - 1] !== "/")) next[j] = 1; break;
					case "any": if (cur[j] || (j > 0 && next[j - 1])) next[j] = 1; break;
					case "dirs":
						if (cur[j] || (seen && path[j - 1] === "/")) next[j] = 1;
						if (cur[j]) seen = true;
						break;
				}
			}
			cur = next;
		}
		if (!prefix) return cur[n] === 1;
		for (let j = 0; j < n; j++) if (cur[j] && path[j] === "/") return true;
		return false;
	};
}
