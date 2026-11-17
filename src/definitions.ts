// Helpers shared by the action and feedback definitions.

interface FieldLike {
	id: string
	isVisibleExpression?: string
	disableAutoExpression?: boolean
}

/**
 * Companion only lets a visibility expression read fields that cannot be switched to expression
 * mode. Every field another field's `isVisibleExpression` reads (`$(options:<id>)`) is locked here.
 */
export function lockVisibilityFields<T extends Record<string, { options: unknown[] } | false | undefined>>(defs: T): T {
	for (const def of Object.values(defs)) {
		if (!def) continue
		const fields = def.options as FieldLike[]
		const read = new Set<string>()
		for (const f of fields)
			for (const m of (f.isVisibleExpression ?? '').matchAll(/\$\(options:([A-Za-z0-9_-]+)\)/g)) read.add(m[1])
		for (const f of fields) if (read.has(f.id)) f.disableAutoExpression = true
	}
	return defs
}

/** An option value as text: '' when it is missing or not a string, number or boolean. */
export function optionText(v: unknown): string {
	if (typeof v === 'string') return v
	if (typeof v === 'number' || typeof v === 'boolean') return String(v)
	return ''
}
