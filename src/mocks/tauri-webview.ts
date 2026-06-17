// Mock for @tauri-apps/api/webviewWindow — used in VITE_BROWSER=true preview mode

export const getCurrentWebviewWindow = () => ({
  onDragDropEvent: async (_handler: unknown) => () => {},
});
