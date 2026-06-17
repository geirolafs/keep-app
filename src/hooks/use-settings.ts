import Database from "@tauri-apps/plugin-sql";

async function getDb() {
  return Database.load("sqlite:keep.db");
}

export type AnalyzeMode = "manual" | "auto_all" | "auto_new";

async function getSetting(key: string): Promise<string | null> {
  try {
    const db = await getDb();
    const rows = await db.select<{ value: string }[]>(
      "SELECT value FROM settings WHERE key = $1",
      [key]
    );
    return rows[0]?.value ?? null;
  } catch {
    return null;
  }
}

async function setSetting(key: string, value: string): Promise<void> {
  try {
    const db = await getDb();
    await db.execute(
      "INSERT OR REPLACE INTO settings (key, value) VALUES ($1, $2)",
      [key, value]
    );
  } catch (err) {
    console.error("[keep] setSetting failed:", err);
  }
}

export function useSettings() {
  return { getSetting, setSetting };
}
