export {};

export interface UpdateState {
  state: "idle" | "checking" | "downloading" | "current" | "ready" | "error" | "dev";
  version?: string;
  percent?: number;
}

declare global {
  interface Window {
    rooms?: {
      screenFrame(): Promise<string | null>;

      speechStart(): Promise<void>;
      speechStop(): Promise<void>;
      onSpeechTranscript(
        cb: (line: { partial?: boolean; text?: string; error?: string; level?: number }) => void,
      ): () => void;
      onSpeechEnd(cb: (info: { code: number | null }) => void): () => void;

      notifyShow(notice: {
        title: string;
        body: string;
        target: string;
        urgent: boolean;
        avatar?: string;
      }): Promise<void>;
      onNotifyActivate(handler: (payload: { target: string }) => void): () => void;
      badgeSet(count: number): Promise<void>;
      filePath(file: File): string;
      pickFolder(): Promise<string | null>;

      appVersion(): Promise<string>;
      updateState(): Promise<UpdateState>;
      updateCheck(): Promise<UpdateState>;
      updateInstall(): Promise<void>;
      onUpdateState(handler: (state: UpdateState) => void): () => void;
      shortcutApply(accelerator: string | null): Promise<string | null>;
      quickHide(): Promise<void>;
      quickOpenMain(): Promise<void>;
      onQuickOpened(handler: () => void): () => void;
      authStatus(): Promise<"biometry" | "password" | "unavailable">;
      authConfirm(
        reason: string,
      ): Promise<"granted" | "denied" | "cancelled" | "unavailable">;

      permStatus(): Promise<{ mic: string; screen: string }>;
      permRequestMic(): Promise<boolean>;
      permOpenSettings(pane: "mic" | "screen" | "speech"): Promise<void>;
      permRequestScreen(): Promise<string>;
    };
  }
}
