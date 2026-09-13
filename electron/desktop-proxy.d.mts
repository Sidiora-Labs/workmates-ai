export function serverAddress(value: string): string;
export function checkCloudServer(url: string, token: string): Promise<string>;
export function startDesktopProxy(options: {
  staticDir?: string;
  devUrl?: string;
  backend: () => { url: string; token?: string } | null;
  port?: number;
}): Promise<{ origin: string; disconnect(): void; close(): Promise<void> }>;
