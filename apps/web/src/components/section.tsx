import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { Alert, AlertDescription } from "@halalfood/ui/components/alert";
import { Button } from "@halalfood/ui/components/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@halalfood/ui/components/collapsible";
import { cn } from "@halalfood/ui/lib/utils";

/** Eyebrow + heading at the top of a page section, with an optional action. */
export function SectionHeading({
  id,
  eyebrow,
  title,
  action,
  as: Heading = "h2",
  className,
}: {
  id?: string;
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  action?: React.ReactNode;
  as?: "h2" | "h3";
  className?: string;
}) {
  return (
    <div className={cn("mb-2.5 flex flex-wrap items-end justify-between gap-3", className)}>
      <div className="grid gap-1">
        {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
        <Heading id={id} className="text-[22px] leading-tight">
          {title}
        </Heading>
      </div>
      {action}
    </div>
  );
}

/** The muted explanatory paragraph under a section heading. */
export function SectionIntro({ className, ...props }: React.ComponentProps<"p">) {
  return <p className={cn("mb-4 text-muted-foreground", className)} {...props} />;
}

/** The dashed "not enough data" state that replaces a figure below the sample floor. */
export function InsufficientData({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      className={cn(
        "mt-2 rounded-lg border border-dashed border-input px-3 py-2.5 text-[13px] text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

/** A small, muted line of supporting copy. */
export function Note({ className, ...props }: React.ComponentProps<"p">) {
  return <p className={cn("text-[13px] text-muted-foreground", className)} {...props} />;
}

/** A plain list with no bullets, rows divided by a hairline. */
export function DividedList({ className, ...props }: React.ComponentProps<"ul">) {
  return <ul className={cn("divide-y", className)} {...props} />;
}

export function Eyebrow({ className, ...props }: React.ComponentProps<"p">) {
  return <p className={cn("text-[13px] font-extrabold text-primary", className)} {...props} />;
}

export function Lead({ className, ...props }: React.ComponentProps<"p">) {
  return <p className={cn("max-w-3xl text-[17px] text-muted-foreground", className)} {...props} />;
}

/** A labelled value inside a <dl>. */
export function MetaItem({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-semibold text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** A collapsed-by-default block behind a link-style toggle, for history and detail. */
export function Disclosure({
  label,
  className,
  children,
}: {
  label: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Collapsible className={className}>
      <CollapsibleTrigger asChild>
        <Button variant="link" className="group h-auto px-0 py-1 font-bold text-foreground">
          {label}
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            className="transition-transform group-data-[state=open]:rotate-180"
            aria-hidden="true"
          />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>{children}</CollapsibleContent>
    </Collapsible>
  );
}

/** A form's outcome message: an error to fix or a success to confirm. */
export function FormMessage({
  tone,
  className,
  children,
}: {
  tone: "error" | "success";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Alert
      variant={tone === "error" ? "destructive" : "success"}
      className={cn(tone === "error" && "border-destructive/30 bg-destructive/5", className)}
      role={tone === "error" ? "alert" : "status"}
    >
      <AlertDescription className="font-bold">{children}</AlertDescription>
    </Alert>
  );
}
