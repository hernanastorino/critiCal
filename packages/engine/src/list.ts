const LIST = new Intl.ListFormat("es", { style: "long", type: "conjunction" });

/** «A», «A y B», «A, B y C»: the one way every text joins a list. */
export const joinList = (items: readonly string[]): string => LIST.format(items);
