/** A BPJPH list page in the same flight-data shape the official site serves, for parser and check tests. */
export function flightPage(rows: unknown[], meta: { currentPage: number; totalItems: number; pageSize?: number; totalPages: number }) {
  const props = { columns: "$a6", data: rows, currentPage: meta.currentPage, totalItems: meta.totalItems, pageSize: meta.pageSize ?? 20, totalPages: meta.totalPages, emptyTitle: "$undefined" };
  const payload = `a4:["$","$La5",null,${JSON.stringify(props)}]\n`;
  return `<!DOCTYPE html><html><body><script>self.__next_f.push([1,"0:{}\\n"])</script><script>self.__next_f.push([1,${JSON.stringify(payload)}])</script></body></html>`;
}

/** Every page of a list of rows, 20 a page, keyed by page number. */
export function flightPages(rows: unknown[], pageSize = 20): Map<number, string> {
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const out = new Map<number, string>();
  for (let page = 1; page <= totalPages; page += 1)
    out.set(page, flightPage(rows.slice((page - 1) * pageSize, page * pageSize), { currentPage: page, totalItems: rows.length, pageSize, totalPages }));
  return out;
}
