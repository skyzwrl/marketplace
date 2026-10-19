type Table = Record<string | number, unknown>;

export function copyDeep<T>(value: T): T {
	if (!typeIs(value, "table")) {
		return value;
	}
	const copy: Table = {};
	for (const [key, item] of pairs(value as Table)) {
		copy[key] = copyDeep(item);
	}
	return copy as T;
}

// rolls target back to snapshot in place, so anything else holding the data table (the session,
// a cache) sees the rollback too. snapshot must be a private copy, its tables get reused
export function restoreInto(target: object, snapshot: object): void {
	const current = target as Table;
	const saved = snapshot as Table;

	for (const [key] of pairs(current)) {
		if (saved[key] === undefined) {
			current[key] = undefined;
		}
	}

	for (const [key, value] of pairs(saved)) {
		const existing = current[key];
		if (typeIs(value, "table") && typeIs(existing, "table")) {
			restoreInto(existing, value);
		} else {
			current[key] = value;
		}
	}
}
