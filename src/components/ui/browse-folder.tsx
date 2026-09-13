import FolderOpen from "lucide-react/dist/esm/icons/folder-open.mjs";
import { cn } from "@/lib/cn";
import { isRemoteServer } from "@/components/settings/ServerConnection";

export function BrowseFolderButton({
  onPick,
  className,
}: {
  onPick: (path: string) => void;
  className?: string;
}) {
  if (!window.rooms?.pickFolder || isRemoteServer()) return null;
  return (
    <button
      type="button"
      title="Choose a folder"
      aria-label="Choose a folder"
      onClick={() => {
        void window.rooms?.pickFolder?.().then((path) => {
          if (path) onPick(path);
        });
      }}
      className={cn(
        "flex h-8 shrink-0 items-center justify-center rounded-lg border border-input px-2.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
        className,
      )}
    >
      <FolderOpen size={15} />
    </button>
  );
}
