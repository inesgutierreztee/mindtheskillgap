export interface BusStopPageResult<T> {
  complete: boolean;
  items: T[];
  pagesFetched: number;
  reason?: string;
}

/** Fetches LTA-style offset pages atomically. A failed/malformed page never
 * masquerades as the terminal empty page, and duplicates are removed by key. */
export async function collectCompleteOffsetPages<T>(options: {
  pageSize: number;
  maxPages: number;
  fetchPage: (skip: number) => Promise<T[]>;
  keyOf: (item: T) => string;
}): Promise<BusStopPageResult<T>> {
  const collected: T[] = [];
  for (let page = 0; page < options.maxPages; page += 1) {
    let values: T[];
    try {
      values = await options.fetchPage(page * options.pageSize);
      if (!Array.isArray(values)) throw new Error('malformed page');
    } catch (error) {
      return {
        complete: false,
        items: [],
        pagesFetched: page,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
    collected.push(...values);
    if (values.length < options.pageSize) {
      const unique = new Map<string, T>();
      for (const item of collected) {
        const key = options.keyOf(item).trim();
        if (key && !unique.has(key)) unique.set(key, item);
      }
      return { complete: true, items: Array.from(unique.values()), pagesFetched: page + 1 };
    }
  }
  return { complete: false, items: [], pagesFetched: options.maxPages, reason: 'terminal page not reached' };
}
