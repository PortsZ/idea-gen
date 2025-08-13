'use client'
import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Wand2, KeyRound, Copy, Dice6, AlertTriangle, Trash2, Loader2 } from "lucide-react";
import OpenAI from "openai"; // 🧠 Official SDK (browser ok with dangerouslyAllowBrowser)

// ------------------------------------------------------------
// BizWord Forge — Single-file Next.js-style page component
// Frontend-only demo that calls OpenAI's Responses API.
// ⚠️ SECURITY: This asks for your API key client-side. Good for demos;
//      terrible for production. In real apps, proxy via a server. 🙅‍♂️🛡️
// Docs: Responses API + Structured Outputs (json_schema)
// ------------------------------------------------------------

// Tailwind is available in canvas previews. Minimal inline UI here.

const DEFAULT_SYSTEM_PROMPT = `You coin punchy, original, business-friendly neologisms and micro-pitches.
Rules:
- Invent novel terms (portmanteaus, affixes, playful blends) that sound brandable.
- Prefer 1-2 words. Avoid trademarks and real brand names.
- Each idea must have: term, pattern, 1–2 sentence pitch, short tagline, possible alt spellings, and a one-line rationale.
- Keep it clean, no profanity.
- Be concrete about what the product does.
`;

const JSON_SCHEMA = {
  name: "BizWords",
  strict: true,
  schema: {
    type: "object",
    properties: {
      ideas: {
        type: "array",
        minItems: 3,
        maxItems: 50,
        items: {
          type: "object",
          properties: {
            term: { type: "string" },
            pattern: { type: "string" },
            pitch: { type: "string" },
            tagline: { type: "string" },
            alt_spellings: { type: "array", items: { type: "string" } },
            rationale: { type: "string" }
          },
          required: ["term", "pattern", "pitch", "tagline", "alt_spellings", "rationale"],
          
          additionalProperties: false
        }
      }
    },
    required: ["ideas"],
    additionalProperties: false
  }
};

function stripCodeFences(txt: string): string {
  if (!txt) return txt;
  return txt
    .replace(/^```json/gm, "")
    .replace(/^```/gm, "")
    .replace(/```$/gm, "")
    .trim();
}

function useLocalStorage<T>(key: string, initialValue: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : initialValue;
    } catch {
      return initialValue;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  }, [key, value]);
  return [value, setValue];
}

type IdeaType = {
  term: string;
  pattern: string;
  pitch: string;
  tagline?: string;
  alt_spellings: string[];
  rationale: string;
};

export default function Idea() {
  // 🗝️ API key (stored locally only if the user opts in)
  const [apiKey, setApiKey] = useLocalStorage("bizword_openai_key", "");
  const [rememberKey, setRememberKey] = useLocalStorage("bizword_remember", false);

  // 🎛️ Controls
  const [topic, setTopic] = useLocalStorage("bizword_topic", "Christian tech");
  const [angle, setAngle] = useLocalStorage("bizword_angle", "make tech to help either ministry, people or any reformed church, with the kingdom of god first");
  const [count, setCount] = useLocalStorage("bizword_count", 12);
  const [temperature, setTemperature] = useLocalStorage("bizword_temp", 0.8);
  const [patterns, setPatterns] = useLocalStorage("bizword_patterns", {
    xification: true,
    uberFor: true,
    gamification: true,
    portmanteau: true,
    suffixer: true,
    verbify: true,
    inventAffix: true
  });

  // 📦 Output
  const [ideas, setIdeas] = useState<IdeaType[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const controllerRef = useRef<AbortController | null>(null);

  const selectedPatterns = useMemo(() =>
    Object.entries(patterns).filter(([, v]) => v).map(([k]) => k as keyof typeof patternLabels), [patterns]
  );

  const patternLabels = {
    xification: "X‑ification (enshittification-esque)",
    uberFor: "The Uber‑for / X‑for‑Y",
    gamification: "Gamification",
    portmanteau: "Portmanteau",
    suffixer: "Suffixer (‑ify, ‑verse, ‑stack…)",
    verbify: "Verbify (noun → verb)",
    inventAffix: "Invent a new affix"
  } as const;

  // 🧠 Build the user prompt dynamically
  const builtPrompt = useMemo(() => {
    return `Goal: invent ${count} brandable terms that spark product ideas.\n\n` +
      `Domain/topic: ${topic}\n` +
      (angle ? `Angle/constraints: ${angle}\n` : "") +
      `Patterns to explore: ${selectedPatterns.length ? selectedPatterns.join(", ") : "any that fit"}.\n` +
      `Return ONLY JSON following the provided schema.`;
  }, [topic, angle, count, selectedPatterns]);

  // ▶️ Generate via OpenAI Responses API
  async function run() {
    setError("");
    setIdeas([]);

    if (!apiKey) {
      setError("Enter your OpenAI API key.");
      return;
    }

    setLoading(true);

    // Abort controller to cancel if user clicks stop
  controllerRef.current = new AbortController();

    try {
      const client = new OpenAI({ apiKey, dangerouslyAllowBrowser: true }); // 🙈 demo only — do NOT ship keys in prod
      const data = await client.responses.create(
        {
          model: "o4-mini",
          temperature: 1,
          max_output_tokens: 10000,
          text: {
            format: {
              type: "json_schema",
              name: JSON_SCHEMA.name,
              schema: JSON_SCHEMA.schema,
              strict: JSON_SCHEMA.strict,
            },
          },
          input: [
            { role: "system", content: [{ type: "input_text", text: DEFAULT_SYSTEM_PROMPT }] },
            { role: "user",   content: [{ type: "input_text", text: builtPrompt }] },
          ],
        },
        { signal: controllerRef.current!.signal }
      );

      // Prefer the convenience field when present
      let text = data.output_text ?? "";
      if (!text) {
        // 🧹 Fallback: collect all text parts if output_text isn't present
        try {
          type ResponseContent = { type: string; text?: string };
          type ResponseOutputItem = { content?: ResponseContent[] };

          const chunks: string[] = [];
          for (const item of (data.output || []) as ResponseOutputItem[]) {
            if (item.content && Array.isArray(item.content)) {
              for (const c of item.content) {
                if (typeof c.text === "string") chunks.push(c.text);
                if (c.type === "output_text" && typeof c.text === "string") chunks.push(c.text);
              }
            }
          }
          text = chunks.join("\n");
        } catch { /* noop */ }
      }

      const clean = stripCodeFences(text);
      let parsed: { ideas: IdeaType[] } | undefined;
      try {
        parsed = JSON.parse(clean);
      } catch (e) {
        // If the model included extra prose, try to find JSON block 🤞
        const match = clean.match(/\{[\s\S]*\}$/);
        if (match) parsed = JSON.parse(match[0]);
      }

      if (!parsed || !Array.isArray(parsed.ideas)) {
        throw new Error("Model did not return valid JSON ideas.");
      }

      setIdeas(parsed.ideas);
    } catch (e: unknown) {
      if (e instanceof Error) {
        setError(e.message);
      } else {
        setError(String(e));
      }
    } finally {
      setLoading(false);
    }
  }

  function stop() {
    if (controllerRef.current) controllerRef.current.abort();
    setLoading(false);
  }

  function togglePattern(key: keyof typeof patternLabels) {
    setPatterns((p: typeof patterns) => ({ ...p, [key]: !p[key] }));
  }

  function copyIdeas() {
    const text = ideas.map((i, idx) => `${idx + 1}. ${i.term} — ${i.pitch}`).join("\n");
    navigator.clipboard.writeText(text);
  }

  function downloadJSON() {
    const blob = new Blob([JSON.stringify({ topic, angle, ideas }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "bizword-ideas.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  // 🎲 Quick randomizer for inspiration only (no API)
  function nudge() {
    const samples = [
      "supply chain",
      "fintech risk",
      "edtech assessment",
      "church media",
      "music royalties",
      "remote team rituals",
      "smart kitchens",
      "civic engagement",
      "sports analytics",
      "micro-SaaS ops"
    ];
    setTopic(samples[Math.floor(Math.random() * samples.length)]);
  }

  return (
    <div className="min-h-screen w-full bg-gradient-to-b from-zinc-50 to-zinc-100 text-zinc-900">
      <div className="mx-auto max-w-5xl px-4 py-10">
        <header className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight">BizWord Forge</h1>
            <p className="text-sm text-zinc-600">Forge neologisms that spark products. Frontend demo using OpenAI Responses API.</p>
          </div>
          <motion.button
            whileTap={{ scale: 0.98 }}
            onClick={nudge}
            className="inline-flex items-center gap-2 rounded-2xl border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm hover:bg-zinc-50"
            title="Randomize topic"
          >
            <Dice6 className="h-4 w-4" /> Surprise me
          </motion.button>
        </header>

        {/* API Key Box 🔑 */}
        <section className="mb-6 rounded-2xl border border-zinc-300 bg-white p-4 shadow-sm">
          <div className="mb-2 flex items-center gap-2">
            <KeyRound className="h-4 w-4" />
            <h2 className="text-sm font-semibold">OpenAI API key</h2>
          </div>
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <input
              type="password"
              placeholder="sk-..."
              value={apiKey || ""}
              onChange={(e) => setApiKey(rememberKey ? e.target.value : e.target.value)}
              className="w-full rounded-xl border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm outline-none focus:border-zinc-500"
            />
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={!!rememberKey}
                onChange={(e) => setRememberKey(e.target.checked)}
              />
              Remember key in this browser
            </label>
            <button
              onClick={() => { setApiKey(""); }}
              className="rounded-xl border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-50"
            >
              <Trash2 className="mr-1 inline h-4 w-4" /> Clear
            </button>
          </div>
          <p className="mt-2 text-xs text-zinc-500">
            <AlertTriangle className="mr-1 inline h-3 w-3" />
            Don’t hardcode keys in real apps. Proxy via your own backend. This demo runs fully client‑side.
          </p>
        </section>

        {/* Controls ⚙️ */}
        <section className="mb-6 grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-zinc-300 bg-white p-4 shadow-sm">
            <label className="mb-1 block text-sm font-medium">Topic / industry</label>
            <input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="e.g., music labels, restaurant POS, logistics"
              className="w-full rounded-xl border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm outline-none focus:border-zinc-500"
            />
            <label className="mt-4 mb-1 block text-sm font-medium">Angle / constraints (optional)</label>
            <textarea
              value={angle}
              onChange={(e) => setAngle(e.target.value)}
              rows={3}
              placeholder="e.g., privacy-first, bootstrapped, low-touch onboarding"
              className="w-full rounded-xl border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm outline-none focus:border-zinc-500"
            />
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs uppercase tracking-wide text-zinc-500">Count</label>
                <input type="number" min={3} max={50} value={count}
                       onChange={(e) => setCount(Number(e.target.value))}
                       className="w-24 rounded-xl border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm outline-none focus:border-zinc-500" />
              </div>
              <div>
                <label className="block text-xs uppercase tracking-wide text-zinc-500">Creativity</label>
                <input type="range" min={0} max={1} step={0.05} value={temperature}
                       onChange={(e) => setTemperature(Number(e.target.value))}
                       className="w-full" />
                <div className="text-xs text-zinc-500">Temperature: {temperature}</div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-300 bg-white p-4 shadow-sm">
            <div className="mb-2 text-sm font-medium">Patterns</div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {(Object.keys(patterns) as Array<keyof typeof patternLabels>).map((key) => (
                <label key={key} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={!!patterns[key]} onChange={() => togglePattern(key)} />
                  {patternLabels[key]}
                </label>
              ))}
            </div>
            <div className="mt-4 text-xs text-zinc-500">
              Tip: fewer boxes = more freedom; more boxes = more targeted coinages.
            </div>
          </div>
        </section>

        {/* Actions */}
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <motion.button
            whileTap={{ scale: 0.98 }}
            disabled={loading}
            onClick={run}
            className="inline-flex items-center gap-2 rounded-2xl bg-black px-4 py-2 text-sm font-semibold text-white shadow-sm hover:opacity-90 disabled:opacity-60"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin"/> : <Wand2 className="h-4 w-4" />} Generate
          </motion.button>
          {loading && (
            <button onClick={stop} className="rounded-2xl border border-zinc-300 bg-white px-3 py-2 text-sm hover:bg-zinc-50">Stop</button>
          )}
          <button onClick={copyIdeas} disabled={!ideas.length} className="inline-flex items-center gap-2 rounded-2xl border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm hover:bg-zinc-50 disabled:opacity-50">
            <Copy className="h-4 w-4"/> Copy
          </button>
          <button onClick={downloadJSON} disabled={!ideas.length} className="rounded-2xl border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm hover:bg-zinc-50 disabled:opacity-50">Download JSON</button>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-6 rounded-2xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-800">
            <p className="font-semibold">Error</p>
            <pre className="whitespace-pre-wrap text-xs">{error}</pre>
            <p className="mt-2 text-xs text-rose-700">Common causes: wrong key, model access, or CORS. If you hit CORS or want to hide your key, proxy this call through /api on a Next.js server.</p>
          </div>
        )}

        {/* Results */}
        {!!ideas.length && (
          <section className="grid gap-4 md:grid-cols-2">
            {ideas.map((idea, idx) => (
              <motion.div
                key={idx}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.15, delay: idx * 0.02 }}
                className="rounded-2xl border border-zinc-300 bg-white p-4 shadow-sm"
              >
                <div className="mb-2 flex items-start justify-between">
                  <h3 className="text-lg font-bold tracking-tight">{idea.term}</h3>
                  <span className="rounded-full bg-zinc-100 px-2 py-1 text-xs text-zinc-600">{idea.pattern}</span>
                </div>
                <p className="text-sm leading-relaxed">{idea.pitch}</p>
                {idea.tagline && (
                  <p className="mt-2 text-sm italic text-zinc-600">“{idea.tagline}”</p>
                )}
                {Array.isArray(idea.alt_spellings) && idea.alt_spellings.length > 0 && (
                  <p className="mt-2 text-xs text-zinc-500">Alt spellings: {idea.alt_spellings.join(", ")}</p>
                )}
                {idea.rationale && (
                  <p className="mt-2 text-xs text-zinc-500">Why it works: {idea.rationale}</p>
                )}
              </motion.div>
            ))}
          </section>
        )}

        <footer className="mt-10 text-center text-xs text-zinc-500">
          <p>
            Uses the OpenAI <code>Responses API</code> with <code>text.format: json_schema</code> (Structured Outputs) for clean JSON.
          </p>
          <p className="mt-1">Swap models if you like (e.g., <code>gpt-4.1</code> or others you have access to). Keep your key safe in real projects.</p>
        </footer>
      </div>
    </div>
  );
}
