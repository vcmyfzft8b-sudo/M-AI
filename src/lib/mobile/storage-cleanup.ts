type Storage = {
  list: (prefix: string, options: { limit: number; sortBy: { column: string; order: string } }) => Promise<{ data: Array<{ id: string | null; name: string }> | null; error: unknown }>;
  remove: (paths: string[]) => Promise<{ error: unknown }>;
};

/** Delete only server-derived prefixes, in pages, without skipping shifted rows. */
export async function removeStoragePrefix(storage: Storage, prefix: string): Promise<void> {
  if (!prefix || prefix.startsWith("/") || prefix.split("/").some(part => !part || part === "." || part === "..")) throw new Error("Invalid storage prefix");
  while (true) {
    const { data, error } = await storage.list(prefix, { limit: 100, sortBy: { column: "name", order: "asc" } });
    if (error) throw error;
    if (!data?.length) return;
    const files: string[] = [];
    for (const item of data) {
      if (!item.name || item.name.includes("/") || item.name === "." || item.name === "..") throw new Error("Invalid storage path");
      const path = `${prefix}/${item.name}`;
      if (item.id) files.push(path); else await removeStoragePrefix(storage, path);
    }
    if (files.length) { const result = await storage.remove(files); if (result.error) throw result.error; }
  }
}
