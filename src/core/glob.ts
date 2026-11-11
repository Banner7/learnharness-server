/** Glob → unanchored RegExp source. `*` and `?` stay inside one path
 *  segment, `**` crosses folders, and `**` + `/` also matches zero folders.
 *  Everything else is literal. */
export function globSource(glob: string): string {
	let src = "";
	for (let i = 0; i < glob.length; i++) {
		const c = glob[i]!;
		if (c === "*" && glob[i + 1] === "*") {
			if (glob[i + 2] === "/") { src += "(?:[\\s\\S]*/)?"; i += 2; } else { src += "[\\s\\S]*"; i += 1; }
		} else if (c === "*") src += "[^/]*";
		else if (c === "?") src += "[^/]";
		else src += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
	}
	return src;
}

/** Glob → RegExp anchored at both ends (the whole path must match). */
export function globToRegex(glob: string): RegExp {
	return new RegExp(`^${globSource(glob)}$`);
}
