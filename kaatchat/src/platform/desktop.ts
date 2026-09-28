// The narrow bridge the Electron preload exposes. In a browser it is absent.

export interface DesktopHttpRequest {
  url: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: string;
}

export interface DesktopHttpResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
}

export interface DesktopBridge {
  desktop: true;
  version: string;
  platform: string;
  openExternal(url: string): Promise<void>;
  keys: {
    /** True when the OS keychain (DPAPI/Keychain/libsecret) protects keys. */
    secure(): Promise<boolean>;
    has(provider: string): Promise<boolean>;
    set(provider: string, key: string): Promise<void>;
    clear(provider: string): Promise<void>;
  };
  /**
   * Performs an AI provider request from the main process. The main process
   * adds the stored key itself and only talks to that provider's own host,
   * so keys never enter this renderer.
   */
  aiFetch(requestId: string, provider: string, req: DesktopHttpRequest): Promise<DesktopHttpResponse>;
  aiCancel(requestId: string): Promise<void>;
}

declare global {
  interface Window {
    kaatchat?: DesktopBridge;
  }
}

export const desktop: DesktopBridge | null =
  typeof window !== 'undefined' && window.kaatchat?.desktop ? window.kaatchat : null;

export const isDesktop = desktop !== null;
