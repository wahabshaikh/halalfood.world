"use client";

import { useEffect, useRef, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  DrinkIcon,
  FileRemoveIcon,
  FileValidationIcon,
  GlassWaterIcon,
  HelpCircleIcon,
  Knife01Icon,
  Settings02Icon,
  SteakIcon,
  ViewOffIcon,
} from "@hugeicons/core-free-icons";
import { Alert, AlertDescription } from "@halalfood/ui/components/alert";
import { Button, buttonVariants } from "@halalfood/ui/components/button";
import { Field, FieldError, FieldLabel } from "@halalfood/ui/components/field";
import { Progress } from "@halalfood/ui/components/progress";
import { Textarea } from "@halalfood/ui/components/textarea";
import { ToggleGroup, ToggleGroupItem } from "@halalfood/ui/components/toggle-group";
import { cn } from "@halalfood/ui/lib/utils";
import { Illustration } from "../../../../src/components/art";
import { EmptyPanel, Eyebrow } from "../../../../src/components/site-chrome";

type Question = "certificate" | "alcohol" | "meat";
type Answers = Record<Question, string | null>;
type AuthState = "checking" | "signed-in" | "signed-out";

type Option = { value: string; label: string; icon: React.ReactNode };

const STEPS: { question: Question; title: string; hint: string; options: Option[] }[] = [
  {
    question: "certificate",
    title: "Can you see a halal certificate?",
    hint: "Have a look near the counter or the door. Just tell us what you see today.",
    options: [
      { value: "seen", label: "Yes, it’s on display", icon: <HugeiconsIcon icon={FileValidationIcon} size={30} strokeWidth={1.5} /> },
      { value: "not-seen", label: "No certificate", icon: <HugeiconsIcon icon={FileRemoveIcon} size={30} strokeWidth={1.5} /> },
      { value: "unsure", label: "I couldn’t see", icon: <HugeiconsIcon icon={ViewOffIcon} size={30} strokeWidth={1.5} /> },
    ],
  },
  {
    question: "alcohol",
    title: "Is alcohol served here?",
    hint: "Check the menu or the fridge, or ask the staff.",
    options: [
      { value: "none", label: "No alcohol", icon: <HugeiconsIcon icon={GlassWaterIcon} size={30} strokeWidth={1.5} /> },
      { value: "served", label: "Yes, it’s served", icon: <HugeiconsIcon icon={DrinkIcon} size={30} strokeWidth={1.5} /> },
      { value: "unsure", label: "Not sure", icon: <HugeiconsIcon icon={HelpCircleIcon} size={30} strokeWidth={1.5} /> },
    ],
  },
  {
    question: "meat",
    title: "How is the meat slaughtered?",
    hint: "If you asked the staff or saw the supplier’s paperwork, tell us what they said.",
    options: [
      { value: "hand", label: "Hand-slaughtered", icon: <HugeiconsIcon icon={Knife01Icon} size={30} strokeWidth={1.5} /> },
      { value: "machine", label: "Machine-slaughtered", icon: <HugeiconsIcon icon={Settings02Icon} size={30} strokeWidth={1.5} /> },
      { value: "unsure", label: "I didn’t ask", icon: <HugeiconsIcon icon={SteakIcon} size={30} strokeWidth={1.5} /> },
    ],
  },
];

const PHOTO_STEP = STEPS.length;
const DONE_STEP = STEPS.length + 1;
const MAX_BYTES = 8 * 1024 * 1024;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function body(response: Response) {
  try {
    return record(await response.json());
  } catch {
    return null;
  }
}

function errorFrom(value: Record<string, unknown> | null, fallback: string) {
  return typeof value?.error === "string" && value.error.trim() ? value.error : fallback;
}

export default function CheckFlow({ placeId, placeName }: { placeId: string; placeName: string }) {
  const [auth, setAuth] = useState<AuthState>("checking");
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Answers>({ certificate: null, alcohol: null, meat: null });
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const placeHref = `/place/${encodeURIComponent(placeId)}`;
  const selfHref = `${placeHref}/check`;

  useEffect(() => {
    let active = true;
    fetch("/api/auth/get-session", {
      credentials: "include",
      cache: "no-store",
      headers: { Accept: "application/json" },
    })
      .then(body)
      .then((payload) => {
        if (active) setAuth(typeof record(payload?.user)?.id === "string" ? "signed-in" : "signed-out");
      })
      .catch(() => {
        if (active) setAuth("signed-out");
      });
    return () => {
      active = false;
    };
  }, []);

  const informative = Object.values(answers).some((value) => value && value !== "unsure");

  async function send() {
    setError("");
    if (!informative && !file) {
      setError("Answer at least one question with yes or no, or add a photo.");
      return;
    }
    if (file && (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > MAX_BYTES)) {
      setError("Photos need to be JPEG, PNG or WebP, up to 8 MB.");
      return;
    }
    setBusy(true);
    try {
      const evidence: unknown[] = [];
      if (file) {
        const form = new FormData();
        form.set("file", file);
        const upload = await fetch(`/api/uploads/r2?returnTo=${encodeURIComponent(selfHref)}`, {
          method: "POST",
          credentials: "include",
          body: form,
        });
        const uploaded = await body(upload);
        if (upload.status === 401) {
          setAuth("signed-out");
          return;
        }
        if (
          !upload.ok ||
          typeof uploaded?.key !== "string" ||
          typeof uploaded.contentType !== "string" ||
          typeof uploaded.sizeBytes !== "number" ||
          typeof uploaded.fileName !== "string"
        ) {
          setError(errorFrom(uploaded, "That photo couldn’t be uploaded. Try another, or skip it."));
          return;
        }
        evidence.push({
          kind: "upload",
          key: uploaded.key,
          contentType: uploaded.contentType,
          sizeBytes: uploaded.sizeBytes,
          fileName: uploaded.fileName,
        });
      }
      const response = await fetch(`/api/places/${encodeURIComponent(placeId)}/verifications`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ answers, evidence, note }),
      });
      const payload = await body(response);
      if (response.status === 401) {
        setAuth("signed-out");
        return;
      }
      if (!response.ok) {
        setError(errorFrom(payload, "We couldn’t send your check. Please try again."));
        return;
      }
      setStep(DONE_STEP);
    } catch {
      setError("We couldn’t send your check. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const progress = Math.min(step, PHOTO_STEP + 1) / (PHOTO_STEP + 1);
  const current = STEPS[step];

  if (auth === "signed-out")
    return (
      <StepperBody className="justify-items-start">
        <Illustration name="vouches" size={96} />
        <h1 className="text-[clamp(26px,4vw,32px)]">Check {placeName}</h1>
        <p className="text-muted-foreground">
          Log in with a one-time email code so your check has a name on it. It takes a
          minute, and you’ll come straight back here.
        </p>
        <div className="flex flex-wrap gap-2.5">
          <Button asChild size="xl">
            <a href={`/login?returnTo=${encodeURIComponent(selfHref)}`}>Log in to check</a>
          </Button>
          <Button asChild size="xl" variant="outline">
            <a href={placeHref}>Not now</a>
          </Button>
        </div>
      </StepperBody>
    );

  if (step === DONE_STEP)
    return (
      <StepperBody>
        <EmptyPanel
          art="vouches"
          title="Thank you!"
          description={`Your check for ${placeName} is with our reviewers. Once it’s approved, it’s the first thing the next person will see.`}
        >
          <Button asChild size="xl">
            <a href={placeHref}>Back to {placeName}</a>
          </Button>
          <Button asChild size="xl" variant="outline">
            <a href="/leaderboard">See the community</a>
          </Button>
        </EmptyPanel>
      </StepperBody>
    );

  return (
    <>
      <StepperBody>
        <Eyebrow>At {placeName}</Eyebrow>
        {current ? (
          <>
            <h1 className="text-[clamp(26px,4vw,32px)]">{current.title}</h1>
            <p className="text-muted-foreground">{current.hint}</p>
            <ToggleGroup
              type="single"
              variant="outline"
              spacing={3}
              className="mt-3 grid w-full grid-cols-2"
              aria-label={current.title}
              value={answers[current.question] ?? ""}
              onValueChange={(value) => {
                if (!value) return;
                setAnswers((previous) => ({ ...previous, [current.question]: value }));
                setError("");
              }}
            >
              {current.options.map((option) => (
                <ToggleGroupItem
                  key={option.value}
                  value={option.value}
                  className="h-auto min-h-27 flex-col items-start justify-start gap-3 rounded-xl p-4 text-left text-[15px] font-bold whitespace-normal hover:border-foreground data-[state=on]:border-2 data-[state=on]:border-foreground data-[state=on]:bg-secondary [&_svg:not([class*='size-'])]:size-7.5"
                >
                  <span aria-hidden="true">{option.icon}</span>
                  {option.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </>
        ) : (
          <>
            <h1 className="text-[clamp(26px,4vw,32px)]">Snap a quick photo</h1>
            <p className="text-muted-foreground">
              A clear photo of the certificate or the menu helps everyone after you. It’s
              optional.
            </p>
            <label className="grid cursor-pointer justify-items-center gap-3.5 rounded-2xl border-[1.5px] border-dashed border-input bg-secondary px-5 py-9 text-center">
              <Illustration name="photo" size={72} />
              <span className={buttonVariants({ variant: "outline", size: "lg" })}>
                {file ? "Choose a different photo" : "Choose a photo"}
              </span>
              <input
                ref={fileInput}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="sr-only"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
              <span className="text-[13px] text-muted-foreground">
                {file ? file.name : "JPEG, PNG or WebP, up to 8 MB"}
              </span>
            </label>
            <Field className="mt-2">
              <FieldLabel htmlFor="check-note">Anything else? (optional)</FieldLabel>
              <Textarea
                id="check-note"
                value={note}
                maxLength={1000}
                rows={3}
                placeholder="The supplier’s name, when the certificate expires…"
                onChange={(event) => setNote(event.target.value)}
              />
            </Field>
            <Alert variant="warning">
              <AlertDescription>Checks go to a moderator before they show as approved.</AlertDescription>
            </Alert>
          </>
        )}
        {error && <FieldError>{error}</FieldError>}
      </StepperBody>
      <div className="fixed inset-x-0 bottom-0 z-70 bg-background">
        <Progress value={progress * 100} className="h-1 rounded-none" aria-hidden="true" />
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4.5 pt-4 pb-[calc(16px+env(safe-area-inset-bottom))] md:px-6">
          {step === 0 ? (
            <Button asChild variant="link" className="px-0 text-base font-extrabold text-foreground underline">
              <a href={placeHref}>Back</a>
            </Button>
          ) : (
            <Button
              variant="link"
              className="px-0 text-base font-extrabold text-foreground underline"
              onClick={() => setStep((value) => value - 1)}
            >
              Back
            </Button>
          )}
          {step < PHOTO_STEP ? (
            <Button
              size="xl"
              disabled={auth === "checking"}
              onClick={() => setStep((value) => value + 1)}
            >
              {current && answers[current.question] ? "Next" : "Skip"}
            </Button>
          ) : (
            <Button size="xl" disabled={busy} onClick={() => void send()}>
              {busy ? "Sending…" : "Send check"}
            </Button>
          )}
        </div>
      </div>
    </>
  );
}

function StepperBody({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "mx-auto grid w-full max-w-2xl flex-1 content-start gap-3 px-4.5 pt-6 pb-36 md:px-6",
        className,
      )}
      {...props}
    />
  );
}
