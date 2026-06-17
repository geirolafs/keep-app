// Mock for @tauri-apps/api/core — used in VITE_BROWSER=true preview mode

export const invoke = async (_cmd: string, _args?: unknown) => null;

// In the real app, imgSrc() short-circuits for http URLs before calling this.
// Returning the path unchanged means seed image URLs pass through directly.
export const convertFileSrc = (path: string) => path;
