export interface PlayerData {
	coins: number;
	gems: number;
	potions: number;
	cosmetics: string[];
	purchaseIds: string[];
	shopPurchases: Record<string, number>;
}

// stands in for whatever loads player data. it should be session locked so two servers never grant
// against the same copy
export declare const profiles: {
	get(player: Player): { data: PlayerData; save(): boolean } | undefined;
};
