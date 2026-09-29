// Mundwerk – KI-Funktion (Supabase Edge Function)
// Ruft die Claude API auf. Der API-Schlüssel bleibt auf dem Server.
// Die Prompts werden hier gebaut, damit die Funktion nur für die drei
// Lernwerkzeuge der App taugt und nicht als allgemeiner Claude-Zugang.

import { createClient } from "npm:@supabase/supabase-js@2";

const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const TAGESLIMIT = Number(Deno.env.get("KI_TAGESLIMIT") ?? "40");
const MODELL_SCHNELL = Deno.env.get("KI_MODELL_SCHNELL") ?? "claude-haiku-4-5-20251001";
const MODELL = Deno.env.get("KI_MODELL") ?? "claude-sonnet-5-5";
const URSPRUNG = Deno.env.get("ERLAUBTER_URSPRUNG") ?? "*";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": URSPRUNG,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const STIL =
  'Schreibe im Tiroler Dialekt der Innsbrucker Umgangssprache (Mitteltirol). Schreibweise einheitlich: å für das dunkle a, "isch" für ist, 2. Person auf -sch (du håsch, du bisch, du kimmsch), "nit" für nicht, "eppes" für etwas, "heint" für heute, "enk" für euch, ei->oa wo lautgesetzlich (hoaß, zwoa, kloan), u->ua (guat), ie->ia (liab), ü->i/ia (griaß, miad). Verwende keine Wiener oder bairischen Formen wie "ned", "ebbas", "Hawara". Erfinde keine Wörter; nimm im Zweifel die gebräuchliche Umgangssprache.';

const ROLLEN: Record<string, { ort: string; rolle: string; lernend: string }> = {
  dokter: { ort: "Eine Hausarztpraxis in Innsbruck.", rolle: "die Ärztin (siezt die Person)", lernend: "Patient oder Patientin mit Erkältung" },
  gschaeft: { ort: "Die Wurst- und Käsetheke in einem Tiroler Supermarkt.", rolle: "die Verkäuferin (duzt, wie in Tirol üblich)", lernend: "Kunde oder Kundin" },
  wirt: { ort: "Ein Tiroler Gasthaus am Mittag.", rolle: "der Kellner", lernend: "Gast" },
  berg: { ort: "Eine Almhütte oberhalb von Innsbruck.", rolle: "der Hüttenwirt", lernend: "Wanderer oder Wanderin" },
  baustell: { ort: "Eine Baustelle im Inntal, erster Arbeitstag.", rolle: "der Polier", lernend: "neuer Kollege oder neue Kollegin" },
  nachbar: { ort: "Das Stiegenhaus eines Wohnhauses in Innsbruck.", rolle: "die ältere Nachbarin, gesprächig", lernend: "neu eingezogene Person" },
};

function antwort(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

function jsonAusText(text: string): unknown {
  try { return JSON.parse(text); } catch { /* weiter */ }
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) { try { return JSON.parse(fence[1]); } catch { /* weiter */ } }
  const a = Math.min(...["[", "{"].map((c) => text.indexOf(c)).filter((i) => i >= 0));
  const b = Math.max(text.lastIndexOf("]"), text.lastIndexOf("}"));
  if (Number.isFinite(a) && b > a) return JSON.parse(text.slice(a, b + 1));
  throw new Error("Kein JSON");
}

type Nachricht = { role: "user" | "assistant"; content: string };

async function claude(modell: string, system: string, messages: Nachricht[], maxTokens: number) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: modell, max_tokens: maxTokens, system, messages }),
  });
  if (!r.ok) {
    console.error("Claude API", r.status, await r.text());
    throw new Error("Claude API " + r.status);
  }
  const data = await r.json();
  return (data.content ?? []).filter((c: { type: string }) => c.type === "text").map((c: { text: string }) => c.text).join("");
}

// Aufeinanderfolgende Nachrichten gleicher Rolle zusammenführen; muss mit user beginnen und enden.
function verlaufBereinigen(v: unknown): Nachricht[] {
  if (!Array.isArray(v)) return [];
  const out: Nachricht[] = [];
  for (const m of v.slice(-20)) {
    if (!m || (m.role !== "user" && m.role !== "assistant")) continue;
    const content = String(m.content ?? "").slice(0, 600).trim();
    if (!content) continue;
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.content += "\n" + content;
    else out.push({ role: m.role, content });
  }
  while (out.length && out[0].role !== "user") out.shift();
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return antwort(405, { fehler: "Nur POST." });
  if (!ANTHROPIC_KEY) return antwort(500, { fehler: "Die KI ist auf dem Server noch nicht eingerichtet." });

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const nutzerClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: { user } } = await nutzerClient.auth.getUser(token);
  if (!user) return antwort(401, { fehler: "Bitte melde dich an, um die KI zu nutzen." });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return antwort(400, { fehler: "Ungültige Anfrage." }); }

  const aufgabe = String(body.aufgabe ?? "");
  let modell = MODELL, system = "", messages: Nachricht[] = [], maxTokens = 800, alsJson = false;

  if (aufgabe === "rolle") {
    const r = ROLLEN[String(body.rolle)];
    if (!r) return antwort(400, { fehler: "Unbekannte Situation." });
    messages = verlaufBereinigen(body.verlauf);
    if (!messages.length) messages = [{ role: "user", content: "Beginne das Gespräch mit deinem ersten Satz." }];
    if (messages[messages.length - 1].role !== "user") return antwort(400, { fehler: "Ungültiger Verlauf." });
    modell = MODELL_SCHNELL; maxTokens = 400;
    system = `Du bist Gesprächspartner in einer Lern-App für Tiroler Dialekt. Rollenspiel. Ort: ${r.ort} Du spielst ${r.rolle}. Die lernende Person ist ${r.lernend}. ${STIL} Antworte immer kurz (ein bis zwei Sätze), natürlich und freundlich, und führe das Gespräch mit einer Frage oder Handlung weiter. Bleib in der Rolle, auch wenn die Person vom Thema abweicht. Gib genau dieses Format aus, ohne weiteren Text:
TIROL: <deine Antwort im Dialekt>
DEUTSCH: <dieselbe Antwort auf Hochdeutsch>
TIPP: <nur wenn die letzte Nachricht der lernenden Person Hochdeutsch oder fehlerhafter Dialekt war: wie man ihren Satz auf Tirolerisch sagt, sonst diese Zeile weglassen>`;
  } else if (aufgabe === "uebersetzen") {
    const text = String(body.text ?? "").trim().slice(0, 600);
    if (!text) return antwort(400, { fehler: "Kein Text." });
    alsJson = true;
    system = `Du überträgst hochdeutsche Sätze in Tiroler Dialekt für eine Lern-App. ${STIL}`;
    messages = [{ role: "user", content: `Satz: «${text}»\nAntworte nur mit JSON: {"t": "<Satz auf Tirolerisch>", "n": "<ein bis zwei kurze Sätze zu den auffälligsten Dialektmerkmalen darin>"}` }];
  } else if (aufgabe === "karten") {
    const thema = String(body.thema ?? "").trim().slice(0, 200);
    const anzahl = [6, 12, 20].includes(Number(body.anzahl)) ? Number(body.anzahl) : 12;
    if (!thema) return antwort(400, { fehler: "Kein Thema." });
    alsJson = true; maxTokens = 3000;
    system = `Du erstellst Lernkarten für Tiroler Dialekt. ${STIL} Wenn ein Ausdruck nur regional (z. B. Zillertal, Oberland) üblich ist, vermerke das im Hinweis.`;
    messages = [{ role: "user", content: `Erstelle ${anzahl} Lernkarten zum Thema: «${thema}». Mische nützliche Einzelwörter und kurze Alltagssätze, die man in dieser Situation wirklich braucht. Antworte nur mit einem JSON-Array: [{"t":"<Tirolerisch>","d":"<Hochdeutsch>","n":"<kurzer Hinweis zu Aussprache oder Gebrauch, sonst leer>"}]` }];
  } else {
    return antwort(400, { fehler: "Unbekannte Aufgabe." });
  }

  const dienst = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: erlaubt, error } = await dienst.rpc("ki_verbrauchen", { p_user: user.id, p_limit: TAGESLIMIT });
  if (error) { console.error(error); return antwort(500, { fehler: "Kontingent konnte nicht geprüft werden." }); }
  if (!erlaubt) return antwort(429, { fehler: `Du hast heute schon ${TAGESLIMIT} KI-Anfragen gestellt. Morgen geht es weiter.` });

  try {
    const text = await claude(modell, system, messages, maxTokens);
    if (!alsJson) return antwort(200, { text });
    try { return antwort(200, { daten: jsonAusText(text) }); }
    catch { return antwort(502, { fehler: "Die Antwort war nicht lesbar. Probier es nochmal." }); }
  } catch {
    return antwort(502, { fehler: "Die KI ist gerade nicht erreichbar. Probier es gleich nochmal." });
  }
});
