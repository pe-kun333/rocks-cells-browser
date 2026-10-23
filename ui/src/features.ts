// Optional Grok Bot / external-bot features (bot dock, bot inbox, Grok export / patch import, "Send to Grok").
// Off by default. Build with VITE_ROCKSCELLS_BOTS=1 (and cmake -DROCKSCELLS_BOT_FEATURES=ON) to turn them on.
export const BOT_FEATURES: boolean = import.meta.env.VITE_ROCKSCELLS_BOTS === '1';

// Built-in hex-memo (web build). The exe maps its 'hexmemo' folder to this host (src/tabs.cpp).
export const HEXMEMO_URL = 'https://hexmemo.local/';

// Version label (from version.json via vite define)
declare const __APP_VERSION_LABEL__: string;
export const APP_VERSION_LABEL: string = typeof __APP_VERSION_LABEL__ === 'string' ? __APP_VERSION_LABEL__ : '';
export const APP_TITLE = `Rocks-cells Browser ${APP_VERSION_LABEL}`.trim();
