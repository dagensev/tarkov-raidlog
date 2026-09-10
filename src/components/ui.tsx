import type { CSSProperties, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/** A bordered plate with reticle corners. The base surface for everything. */
export function Panel({
  children,
  className,
  style,
  as: Tag = "section",
}: {
  children: ReactNode;
  className?: string;
  /** Used for staggering the load animation via `animationDelay`. */
  style?: CSSProperties;
  as?: "section" | "div" | "aside";
}) {
  return (
    <Tag style={style} className={cx("bracket border border-line bg-panel/70", className)}>
      {children}
    </Tag>
  );
}

/** Stencilled crate-tag header with a ruler edge beneath it. */
export function PanelHeader({
  title,
  meta,
  action,
}: {
  title: string;
  meta?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="border-b border-line">
      <div className="flex items-baseline justify-between gap-4 px-4 pt-3 pb-2">
        <h2 className="stencil text-[11px] text-amber">{title}</h2>
        <div className="flex items-center gap-3">
          {meta ? <span className="data text-[11px] text-muted">{meta}</span> : null}
          {action}
        </div>
      </div>
      <div className="ticks h-[3px] opacity-40" />
    </header>
  );
}

export function Label({ children }: { children: ReactNode }) {
  return <span className="stencil text-[10px] text-muted">{children}</span>;
}

type Tone = "amber" | "moss" | "rust" | "steel" | "muted";

const TONE: Record<Tone, string> = {
  amber: "border-amber/40 text-amber bg-amber/10",
  moss: "border-moss/40 text-moss bg-moss/10",
  rust: "border-rust/45 text-rust bg-rust/10",
  steel: "border-steel/40 text-steel bg-steel/10",
  muted: "border-line-bright text-bone-dim bg-transparent",
};

export function Pill({
  children,
  tone = "muted",
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={cx(
        // Never wraps: a badge that breaks across two lines stops reading as one label,
        // and the letter-spacing makes even a short one wider than it looks.
        "data inline-flex shrink-0 items-center gap-1.5 border px-1.5 py-[1px] text-[10px] whitespace-nowrap uppercase tracking-wider",
        TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Small square status lamp. `live` makes it breathe. */
export function Lamp({ tone = "muted", live = false }: { tone?: Tone; live?: boolean }) {
  const fill: Record<Tone, string> = {
    amber: "bg-amber",
    moss: "bg-moss",
    rust: "bg-rust",
    steel: "bg-steel",
    muted: "bg-muted",
  };
  return (
    <span
      aria-hidden
      className={cx("inline-block size-[7px] shrink-0", fill[tone], live && "live-dot")}
    />
  );
}

export function Button({
  children,
  onClick,
  variant = "default",
  disabled,
  className,
  type = "button",
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "default" | "primary" | "ghost";
  disabled?: boolean;
  className?: string;
  type?: "button" | "submit";
  title?: string;
}) {
  const styles = {
    default:
      "border-line-bright bg-panel-2 text-bone hover:border-amber-dim hover:text-amber disabled:hover:border-line-bright",
    primary:
      "border-amber bg-amber text-ground font-semibold hover:bg-amber-dim hover:border-amber-dim",
    ghost: "border-transparent text-bone-dim hover:text-amber hover:border-line-bright",
  }[variant];

  return (
    <button
      type={type}
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={cx(
        "stencil cursor-pointer border px-3 py-1.5 text-[10px] transition-colors",
        "disabled:cursor-not-allowed disabled:opacity-40",
        styles,
        className,
      )}
    >
      {children}
    </button>
  );
}

/** A labelled figure. Reads as an instrument readout rather than a marketing stat. */
export function Readout({
  label,
  value,
  tone = "bone",
  hint,
}: {
  label: string;
  value: ReactNode;
  tone?: "bone" | "amber" | "moss" | "rust" | "muted";
  hint?: string;
}) {
  const color = {
    bone: "text-bone",
    amber: "text-amber",
    moss: "text-moss",
    rust: "text-rust",
    muted: "text-muted",
  }[tone];
  return (
    <div className="flex flex-col gap-1">
      <Label>{label}</Label>
      <span className={cx("data text-2xl leading-none", color)}>{value}</span>
      {hint ? <span className="data text-[10px] text-muted">{hint}</span> : null}
    </div>
  );
}

export function EmptyNote({ children }: { children: ReactNode }) {
  return <p className="px-4 py-6 text-center text-[13px] text-muted">{children}</p>;
}

/**
 * The three form surfaces, which were the same class string copy-pasted onto raw elements
 * across the tasks, sell and squad pages until a third table needed them again.
 *
 * They stay thin wrappers over the native elements rather than growing an API: every
 * caller wants a different `onChange` type, and the value of lifting them was never the
 * props, only the border, the ground and the amber focus ring being the same everywhere.
 */
const FIELD =
  "data border border-line-bright bg-ground-2 px-2 py-1.5 text-[12px] text-bone placeholder:text-muted focus:border-amber-dim focus:outline-none";

export function TextField({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(FIELD, className)} />;
}

export function SelectField({
  className,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={cx(FIELD, className)}>
      {children}
    </select>
  );
}

/**
 * A filter chip: a button that stays lit while its filter is on.
 *
 * `aria-pressed` rather than a role of its own — it is a toggle, and a screen reader that
 * only sees the amber border learns nothing.
 */
export function Chip({
  children,
  active,
  onClick,
  title,
  className,
}: {
  children: ReactNode;
  active: boolean;
  onClick: () => void;
  title?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        "stencil cursor-pointer border px-3 py-1.5 text-[10px] transition-colors",
        active
          ? "border-amber bg-amber/15 text-amber"
          : "border-line-bright text-muted hover:text-bone-dim",
        className,
      )}
    >
      {children}
    </button>
  );
}
