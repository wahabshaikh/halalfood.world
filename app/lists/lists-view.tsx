"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import type { PlaceList } from "../../src/lib/place-lists";

/**
 * Personal collections. A ranked list published to other people may only hold
 * places the owner has actually visited — the API enforces that, and the copy
 * here says so before someone hits the error.
 */
export default function ListsView() {
  const [lists, setLists] = useState<PlaceList[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [title, setTitle] = useState("");
  const [ranked, setRanked] = useState(true);
  const [visibility, setVisibility] = useState<"public" | "unlisted" | "private">("public");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const response = await fetch("/api/lists");
      if (response.status === 401) {
        const body = await response.json();
        if (typeof body.loginUrl === "string") window.location.href = body.loginUrl;
        return;
      }
      if (!response.ok) throw new Error();
      const body = await response.json();
      setLists(Array.isArray(body.lists) ? body.lists : []);
      setState("ready");
    } catch {
      setState("error");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function create() {
    setError(null);
    try {
      const response = await fetch("/api/lists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, ranked, visibility }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(typeof body.error === "string" ? body.error : "Could not create that list.");
        return;
      }
      setTitle("");
      await load();
    } catch {
      setError("Could not reach the server.");
    }
  }

  if (state === "loading") return <p className="map-place-status">Loading your lists…</p>;
  if (state === "error")
    return <p className="map-place-status">Your lists could not load. Please try again.</p>;

  return (
    <div className="lists-view">
      <section className="list-create">
        <h2>New list</h2>
        <div className="dish-input">
          <input
            className="ui-input"
            value={title}
            maxLength={120}
            placeholder="Top biryani in Mumbai"
            onChange={(event) => setTitle(event.target.value)}
          />
          <button
            type="button"
            className="ui-button ui-button-default"
            disabled={!title.trim()}
            onClick={() => void create()}
          >
            <Plus size={16} aria-hidden="true" />
            Create
          </button>
        </div>
        <div className="chip-row">
          <button
            type="button"
            className={`filter-chip${ranked ? " is-active" : ""}`}
            aria-pressed={ranked}
            onClick={() => setRanked(!ranked)}
          >
            Ranked
          </button>
          {(["public", "unlisted", "private"] as const).map((option) => (
            <button
              key={option}
              type="button"
              className={`filter-chip${visibility === option ? " is-active" : ""}`}
              aria-pressed={visibility === option}
              onClick={() => setVisibility(option)}
            >
              {option[0].toUpperCase() + option.slice(1)}
            </button>
          ))}
        </div>
        <p className="filter-note">
          A ranked list you publish may only contain places you have recorded a
          visit to. That is what makes it your ranking rather than a repackaged
          aggregate — keep it private while you are still building it.
        </p>
        {error && <p className="check-in-error" role="alert">{error}</p>}
      </section>

      {lists.length === 0 ? (
        <p className="insufficient-data">You have not made a list yet.</p>
      ) : (
        <ul className="list-index">
          {lists.map((list) => (
            <li key={list.id}>
              <a href={`/list/${list.id}`}>
                <strong>{list.title}</strong>
                <span>
                  {list.itemCount} {list.itemCount === 1 ? "place" : "places"} ·{" "}
                  {list.ranked ? "ranked" : "unranked"} · {list.visibility}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
