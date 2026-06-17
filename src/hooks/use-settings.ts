import Database from "@tauri-apps/plugin-sql";

async function getDb() {
  return Database.load("sqlite:mood.db");
}

export type AnalyzeMode = "manual" | "auto_all" | "auto_new";

export function useSettings() {
  const getSetting = async (key: string): Promise<string | null> => {
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
  };

  const setSetting = async (key: string, value: string): Promise<void> => {
    try {
      const db = await getDb();
      await db.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ($1, $2)",
        [key, value]
      );
    } catch (err) {
      console.error("[mood] setSetting failed:", err);
    }
  };

  return { getSetting, setSetting };
}
