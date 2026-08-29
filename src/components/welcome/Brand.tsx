import { CreatureMark } from "../agents/Avatar";
import { cn } from "@/lib/cn";

import { LOGO_PATH, LOGO_VIEWBOX } from "./logo-path";

export function WorkmatesMark({
  size = 32,
  fill,
  className,
}: {
  size?: number;
  fill?: string;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={LOGO_VIEWBOX}
      role="img"
      aria-label="Workmates"
      className={cn("shrink-0", className)}
    >
      <path fill={fill ?? "currentColor"} d={LOGO_PATH} />
    </svg>
  );
}

function Sparkle({ size, color }: { size: number; color: string }) {
  const c = size / 3;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
      <g fill={color}>
        <rect x={c} y={0} width={c} height={c} />
        <rect x={0} y={c} width={c} height={c} />
        <rect x={c * 2} y={c} width={c} height={c} />
        <rect x={c} y={c * 2} width={c} height={c} />
      </g>
    </svg>
  );
}

export function BlockField() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden opacity-[0.16] dark:opacity-[0.14]"
    >
      <CreatureMark
        shape="cloud"
        size={110}
        fill="#3fc3f0"
        className="absolute left-[7%] top-[13%]"
      />
      <CreatureMark
        shape="cloud"
        size={72}
        fill="#a468f7"
        className="absolute right-[9%] top-[24%]"
      />
      <CreatureMark
        shape="drop"
        size={46}
        fill="#2ec9a9"
        className="absolute left-[22%] bottom-[24%]"
      />
      <div className="absolute left-[15%] top-[58%]">
        <Sparkle size={21} color="#f972b6" />
      </div>
      <div className="absolute right-[18%] top-[64%]">
        <Sparkle size={27} color="#ffd93b" />
      </div>
      <div className="absolute right-[28%] top-[10%]">
        <Sparkle size={15} color="#3bc76b" />
      </div>
      <div className="absolute left-[36%] bottom-[12%]">
        <Sparkle size={18} color="#4c86f5" />
      </div>
      <div className="absolute right-[7%] bottom-[18%] size-[22px] bg-[#ff9432]" />
      <div className="absolute left-[9%] bottom-[38%] size-[13px] bg-[#f04438]" />
    </div>
  );
}

export function WorkmatesLogo({
  compact = false,
  className = "h-12",
}: {
  compact?: boolean;
  className?: string;
}) {
  if (compact) return <WorkmatesMark size={28} />;
  return (
    <>
      <img
        src="/brand/workmates-wordmark-light.png"
        alt="Workmates"
        className={`${className} w-auto dark:hidden`}
      />
      <img
        src="/brand/workmates-wordmark-dark.png"
        alt="Workmates"
        className={`hidden ${className} w-auto dark:block`}
      />
    </>
  );
}
