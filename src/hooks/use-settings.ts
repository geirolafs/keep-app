import { invoke } from "@tauri-apps/api/core";
import Database from "@tauri-apps/plugin-sql";

async function getDb() {
  return Database.load("sqlite:keep.db");
}

export type AnalyzeMode = "manual" | "auto_all" | "auto_new";

// api_key lives in the macOS Keychain (get_api_key/set_api_key Rust commands),
// not the settings table — plaintext SQLite leaks the secret to anything that
// can read the app data dir. Reads migrate a legacy settings-table key once.
async function getApiKey(): Promise<string | null> {
  try {
    const stored = await invoke<string>("get_api_key");
    if (stored) return stored;
    const db = await getDb();
    const rows = await db.select<{ value: string }[]>(
      "SELECT value FROM settings WHERE key = 'api_key'"
    );
    const legacy = rows[0]?.value;
    if (legacy) {
      await invoke("set_api_key", { key: legacy });
      await db.execute("DELETE FROM settings WHERE key = 'api_key'");
      return legacy;
    }
    return null;
  } catch {
    return null;
  }
}

async function getSetting(key: string): Promise<string | null> {
  if (key === "api_key") return getApiKey();
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
  if (key === "api_key") {
    try {
      await invoke("set_api_key", { key: value });
    } catch (err) {
      console.error("[keep] set_api_key failed:", err);
    }
    return;
  }
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
