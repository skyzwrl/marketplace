import { copyDeep, restoreInto } from "./snapshot";

export interface ShopItem<TData> {
	readonly id: string;
	readonly price: number;
	readonly currency: string;
	/** most that can be bought in one purchase, defaults to 1 */
	readonly maxQuantity?: number;
	/** lifetime cap per player */
	readonly limit?: number;
	/** per server, restock() tops it up */
	readonly stock?: number;
	/** unix seconds, inclusive */
	readonly availableFrom?: number;
	/** unix seconds, exclusive */
	readonly availableUntil?: number;
	readonly grant: (data: TData, quantity: number) => void;
}

export interface ShopOptions<TData extends object> {
	items: ReadonlyArray<ShopItem<TData>>;
	getData: (player: Player) => TData | undefined;
	getBalance: (data: TData, currency: string) => number;
	setBalance: (data: TData, currency: string, amount: number) => void;
	/** item id -> amount bought, stored inside the data so limits survive rejoining */
	getPurchaseCounts: (data: TData) => Record<string, number>;
	clock?: () => number;
	onError?: (message: string) => void;
}

export type ShopFailure =
	| "UnknownItem"
	| "InvalidQuantity"
	| "Unavailable"
	| "NotLoaded"
	| "OutOfStock"
	| "LimitReached"
	| "InsufficientFunds"
	| "GrantFailed";

export type ShopResult =
	| { readonly success: true; readonly itemId: string; readonly quantity: number; readonly cost: number }
	| { readonly success: false; readonly reason: ShopFailure };

function fail(reason: ShopFailure): ShopResult {
	return { success: false, reason };
}

// NaN and inf fail the % 1 check as well
function isWholeNumber(value: unknown): value is number {
	return typeIs(value, "number") && value % 1 === 0;
}

export class Shop<TData extends object> {
	private readonly items = new Map<string, ShopItem<TData>>();
	private readonly stock = new Map<string, number>();
	private readonly options: ShopOptions<TData>;
	private readonly clock: () => number;
	private readonly onError: (message: string) => void;

	public constructor(options: ShopOptions<TData>) {
		this.options = options;
		this.clock = options.clock ?? os.time;
		this.onError = options.onError ?? ((message) => task.spawn(error, message, 0));

		for (const item of options.items) {
			if (this.items.has(item.id)) {
				error(`Shop item "${item.id}" is listed twice`, 3);
			}
			if (!(item.price >= 0 && item.price < math.huge)) {
				error(`Shop item "${item.id}" has an invalid price ${item.price}`, 3);
			}
			const maxQuantity = item.maxQuantity ?? 1;
			if (!isWholeNumber(maxQuantity) || maxQuantity < 1) {
				error(`Shop item "${item.id}" has an invalid maxQuantity ${maxQuantity}`, 3);
			}
			this.items.set(item.id, item);
			if (item.stock !== undefined) {
				this.stock.set(item.id, item.stock);
			}
		}
	}

	public getItem(itemId: string): ShopItem<TData> | undefined {
		return this.items.get(itemId);
	}

	public getStock(itemId: string): number | undefined {
		return this.stock.get(itemId);
	}

	public restock(itemId: string, amount: number): void {
		const remaining = this.stock.get(itemId);
		if (remaining === undefined) {
			error(`Shop item "${itemId}" doesn't track stock`, 2);
		}
		this.stock.set(itemId, remaining + amount);
	}

	public isAvailable(itemId: string): boolean {
		const item = this.items.get(itemId);
		if (item === undefined) {
			return false;
		}
		const now = this.clock();
		return (
			(item.availableFrom === undefined || now >= item.availableFrom) &&
			(item.availableUntil === undefined || now < item.availableUntil)
		);
	}

	// itemId and quantity usually come straight off a remote, so they're checked as untrusted. the
	// price always comes from the catalog
	public purchase(player: Player, itemId: unknown, quantity: unknown = 1): ShopResult {
		const item = typeIs(itemId, "string") ? this.items.get(itemId) : undefined;
		if (item === undefined) {
			return fail("UnknownItem");
		}
		if (!isWholeNumber(quantity) || quantity < 1 || quantity > (item.maxQuantity ?? 1)) {
			return fail("InvalidQuantity");
		}
		if (!this.isAvailable(item.id)) {
			return fail("Unavailable");
		}

		const { getData, getBalance, setBalance, getPurchaseCounts } = this.options;
		const data = getData(player);
		if (data === undefined) {
			return fail("NotLoaded");
		}

		const remaining = this.stock.get(item.id);
		if (remaining !== undefined && remaining < quantity) {
			return fail("OutOfStock");
		}

		const counts = getPurchaseCounts(data);
		const bought = counts[item.id] ?? 0;
		if (item.limit !== undefined && bought + quantity > item.limit) {
			return fail("LimitReached");
		}

		const cost = item.price * quantity;
		const balance = getBalance(data, item.currency);
		if (balance < cost) {
			return fail("InsufficientFunds");
		}

		// nothing between the checks above and this point yields, so two requests from the same
		// player can't both pass the balance check before either one pays
		const snapshot = copyDeep(data);
		const [ok, err] = pcall(() => {
			setBalance(data, item.currency, balance - cost);
			counts[item.id] = bought + quantity;
			item.grant(data, quantity);
		});
		if (!ok) {
			restoreInto(data, snapshot);
			this.onError(`Granting shop item "${item.id}" failed: ${err}`);
			return fail("GrantFailed");
		}

		if (remaining !== undefined) {
			this.stock.set(item.id, remaining - quantity);
		}
		return { success: true, itemId: item.id, quantity, cost };
	}
}
