export interface TransferDatabaseSelection {
    database: string | undefined;
    unavailable: boolean;
}

export function resolveTransferDatabaseSelection(
    current: string | undefined,
    defaultDatabase: string | undefined,
    available: string[],
): TransferDatabaseSelection {
    if (current) {
        return { database: current, unavailable: !available.includes(current) };
    }
    if (defaultDatabase && available.includes(defaultDatabase)) {
        return { database: defaultDatabase, unavailable: false };
    }
    return {
        database: available.length === 1 ? available[0] : undefined,
        unavailable: false,
    };
}
