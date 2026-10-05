import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AppShell } from "../../../src/components/app-shell";
import { getViewerId } from "../../../src/lib/auth-session";
import { loginHref } from "../../../src/lib/signed-out";
import { VideoMatch } from "./video-match";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Save from a video",
  robots: { index: false },
};

export default async function AddVideoPage() {
  if (!(await getViewerId())) redirect(loginHref("/add/video"));
  return (
    <AppShell active="add">
      <VideoMatch />
    </AppShell>
  );
}
