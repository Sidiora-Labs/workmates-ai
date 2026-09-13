import { useEffect, useRef, useState } from "react";
import Check from "lucide-react/dist/esm/icons/check.mjs";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down.mjs";
import { useStore, type Bot, type InstanceInfo } from "@/state/store";
import { ProviderMark } from "./ProviderIcons";
import { cn } from "@/lib/cn";

function modelLabel(instance: InstanceInfo | undefined, model: string): string {
  return instance?.models.options.find((o) => o.id === model)?.label ?? model;
}

const byUsable = (a: InstanceInfo, b: InstanceInfo) =>
  Number(b.snapshot.state === "available") - Number(a.snapshot.state === "available");

function effectiveModel(instance: InstanceInfo | undefined, model: string): string {
  return model || instance?.models.default || "";
}

export function ModelPicker({ bot, className }: { bot: Bot; className?: string }) {
  const { state, dispatch } = useStore();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [railId, setRailId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const selection = bot.modelSelection;
  const active = state.instances.find((i) => i.instanceId === selection.instanceId);
  const railInstance =
    state.instances.find((i) => i.instanceId === (railId ?? selection.instanceId)) ??
    state.instances[0];

  const terms = search.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const options = railInstance?.models.options.filter((option) =>
    terms.every((term) => `${option.id} ${option.label}`.toLowerCase().includes(term)),
  ) ?? [];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pick = (instance: InstanceInfo, model: string) => {
    dispatch({ type: "setModel", botId: bot.id, selection: { instanceId: instance.instanceId, model } });
    setOpen(false);
  };

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        onClick={() => {
          setRailId(selection.instanceId);
          setSearch("");
          setOpen((o) => !o);
        }}
        className="flex h-7 items-center gap-1.5 rounded-lg px-2 text-[12.5px] text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground active:scale-[0.98]"
        aria-label="Choose model"
        aria-expanded={open}
        title={active ? `${active.displayName} · ${modelLabel(active, effectiveModel(active, selection.model))}` : selection.model}
      >
        {active && <ProviderMark driverKind={active.driverKind} size={13} />}
        <span className="max-w-[140px] truncate">{modelLabel(active, effectiveModel(active, selection.model))}</span>
        <ChevronDown size={13} className="opacity-60" />
      </button>

      {open && (
        <div
          data-model-picker-content
          className="absolute right-0 top-full z-30 mt-1.5 flex w-[360px] max-w-[92vw] max-h-[min(480px,70dvh)] origin-top-right animate-pop-in overflow-hidden rounded-[10px] bg-popover/85 shadow-[0_12px_32px_-8px_var(--shadow-color),0_0_0_0.5px_var(--border),0_0_0_1px_var(--shadow-color)] backdrop-blur-2xl backdrop-saturate-150"
        >
          <div className="flex shrink-0 flex-col gap-0.5 overflow-y-auto border-r bg-muted/40 p-1.5">
            {[...state.instances].sort(byUsable).map((instance) => {
              const unavailable = instance.snapshot.state !== "available";
              const onRail = instance.instanceId === railInstance?.instanceId;
              return (
                <button
                  key={instance.instanceId}
                  onClick={() => { setRailId(instance.instanceId); setSearch(""); }}
                  title={
                    unavailable
                      ? `${instance.displayName}: ${instance.snapshot.reason ?? "unavailable"}`
                      : instance.displayName
                  }
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors duration-150",
                    onRail ? "bg-accent" : "hover:bg-accent/60",
                    unavailable && "opacity-40",
                  )}
                >
                  <ProviderMark driverKind={instance.driverKind} size={16} />
                </button>
              );
            })}
          </div>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col p-1.5">
            {railInstance ? (
              <>
                <div className="px-2 pb-1 pt-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-[12.5px] font-semibold text-foreground">
                      {railInstance.displayName}
                    </span>
                    {state.providers.find((p) => p.kind === railInstance.driverKind)?.agentic && (
                      <span className="shrink-0 rounded bg-muted px-1 py-px text-[10px] text-muted-foreground">
                        tools
                      </span>
                    )}
                  </div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {railInstance.snapshot.state === "available"
                      ? (railInstance.snapshot.version ?? "ready")
                      : (railInstance.snapshot.reason ?? "unavailable")}
                  </div>
                </div>
                <input
                  autoFocus
                  type="search"
                  aria-label="Search models"
                  placeholder="Search models…"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  className="mx-1 my-2 min-w-0 shrink-0 rounded-lg border bg-background px-2 py-1.5 text-[13px] outline-none focus:border-ring"
                />
                <div className="px-2 pb-1 text-[11px] text-muted-foreground">
                  {options.length} of {railInstance.models.options.length} models
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                {options.length === 0 && <p className="px-2 py-3 text-[13px] text-muted-foreground">No matching models.</p>}
                {options.map((option) => {
                  const current =
                    selection.instanceId === railInstance.instanceId &&
                    effectiveModel(railInstance, selection.model) === option.id;
                  const disabled = railInstance.snapshot.state !== "available";
                  return (
                    <button
                      key={option.id}
                      disabled={disabled}
                      onClick={() => pick(railInstance, option.id)}
                      className={cn(
                        "flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors duration-150",
                        disabled
                          ? "cursor-not-allowed text-muted-foreground/50"
                          : "text-foreground hover:bg-accent",
                        current && "bg-accent",
                      )}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="min-w-0">
                          <span className="block truncate">{option.label}</span>
                          <span className="block truncate text-[10px] text-muted-foreground" title={option.id}>{option.id}</span>
                        </span>
                        {option.id === railInstance.models.default && (
                          <span className="shrink-0 rounded bg-muted px-1 py-px text-[10px] text-muted-foreground">
                            default
                          </span>
                        )}
                      </span>
                      {current && <Check size={14} className="shrink-0 text-brand-ink" />}
                    </button>
                  );
                })}
                </div>
              </>
            ) : (
              <div className="px-2 py-3 text-[13px] text-muted-foreground">
                No providers. Is the server running?
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
