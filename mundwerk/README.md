# Mundwerk – Tirolerisch lernen

Web-App zum Lernen regionaler Dialekte, beginnend mit Tirolerisch. Die Sätze sind nach Alltagssituationen geordnet. Dazu gibt es eigene Vokabellisten, Karteikarten mit Lernkasten, ein Quiz, Lautregeln, einen KI-Trainer und eine Community: Fehlende Wörter kann man vorschlagen, und ab **20 Stimmen** werden sie automatisch aufgenommen.

## Aufbau

```
mundwerk/
├── public/                  ← das kommt ins Hosting (Netlify)
│   ├── index.html
│   ├── app.js               ← App-Logik
│   ├── data.js              ← Inhalte: Situationen, Dialoge, Lautregeln
│   ├── style.css
│   ├── config.js            ← Supabase-Adresse und öffentlicher Schlüssel
│   ├── impressum.html       ← ENTWURF, ausfüllen
│   ├── datenschutz.html     ← ENTWURF, ausfüllen
│   ├── fonts/               ← Schriftdateien hier ablegen (Schritt 6)
│   └── vendor/              ← supabase.js hier ablegen (Schritt 6)
├── supabase/
│   ├── schema.sql           ← Datenbank, Zugriffsregeln, Auto-Aufnahme
│   └── functions/ki/index.ts← Server-Funktion für die KI
└── netlify.toml
```

**So hängt alles zusammen:**
- **Website:** statische Dateien, kein Build-Schritt.
- **Supabase:** Login per E-Mail-Link, Datenbank und die KI-Funktion.
- **KI-Schlüssel:** Der Claude-API-Schlüssel liegt nur auf dem Server. Jede angemeldete Person hat ein Tageslimit.
- **Ohne `config.js`:** Die App läuft trotzdem, dann aber ohne Konto, Community und KI.

## Einrichtung

### 1. Supabase-Projekt anlegen
1. Auf [supabase.com](https://supabase.com) ein Konto und ein neues Projekt anlegen.
2. Als Region **Central EU (Frankfurt)** wählen. Das ist für den Datenschutz wichtig.
3. Das Datenbank-Passwort sicher aufbewahren.

### 2. Datenbank einrichten
1. **SQL Editor → New query** öffnen.
2. Den Inhalt von `supabase/schema.sql` einfügen und auf **Run** klicken.

Das Skript kann man später gefahrlos erneut ausführen, zum Beispiel nach Änderungen.

### 3. Anmeldung einrichten
1. **Authentication → URL Configuration:**
   - **Site URL:** deine spätere Adresse, zum Beispiel `https://mundwerk.netlify.app`.
   - **Redirect URLs:** dieselbe Adresse eintragen, zusätzlich `http://localhost:8000` zum lokalen Testen.
2. **Authentication → Email Templates → Magic Link:** Betreff und Text auf Deutsch setzen.
   - Betreff: `Dein Anmelde-Link für Mundwerk`
   - Text:
     ```html
     <h2>Griaß di!</h2>
     <p>Klick auf den Link, um dich bei Mundwerk anzumelden:</p>
     <p><a href="{{ .ConfirmationURL }}">Bei Mundwerk anmelden</a></p>
     <p>Wenn du das nicht angefordert hast, kannst du diese E-Mail ignorieren.</p>
     ```
   - „Confirm signup“ genauso anpassen, denn beim allerersten Login kommt diese Vorlage.
3. **Wichtig für den öffentlichen Start:** Der eingebaute E-Mail-Versand von Supabase schafft nur wenige E-Mails pro Stunde. Unter **Authentication → SMTP Settings** einen eigenen E-Mail-Dienst eintragen, zum Beispiel Brevo, Postmark, Mailjet oder das SMTP deines E-Mail-Anbieters.

### 4. KI-Funktion einrichten
Du brauchst einen API-Schlüssel von [console.anthropic.com](https://console.anthropic.com).

**Variante A, im Browser:**
1. Unter **Edge Functions → Deploy a new function → Via Editor** eine Funktion namens **`ki`** anlegen.
2. Den Inhalt von `supabase/functions/ki/index.ts` einfügen und auf **Deploy** klicken.
3. „Verify JWT“ eingeschaltet lassen.

**Variante B, mit der Supabase CLI:**
```bash
supabase login
supabase link --project-ref DEIN-PROJEKT-REF
supabase functions deploy ki
```

Danach unter **Edge Functions → Secrets** eintragen:

| Name | Wert |
|---|---|
| `ANTHROPIC_API_KEY` | dein Schlüssel (Pflicht) |
| `ERLAUBTER_URSPRUNG` | deine Website-Adresse, z. B. `https://mundwerk.netlify.app` (empfohlen, sonst darf jede Seite die Funktion aufrufen) |
| `KI_TAGESLIMIT` | Anfragen pro Person und Tag, Standard `40` |
| `KI_MODELL` | Modell für Übersetzen und Karten, Standard `claude-sonnet-5-5` |
| `KI_MODELL_SCHNELL` | Modell fürs Rollenspiel, Standard `claude-haiku-4-5-20251001` |

### 5. `config.js` ausfüllen
1. Unter **Project Settings → API** die **Project URL** und den **anon public**-Schlüssel kopieren.
2. Beides in `public/config.js` eintragen.

Der anon-Schlüssel darf öffentlich sein, denn die Datenbank schützt sich über ihre Zugriffsregeln. Der **service_role**-Schlüssel darf dagegen **nie** in die Website.

### 6. Bibliothek und Schriften lokal ablegen
Aus Datenschutzgründen lädt die Seite nichts von fremden Servern.

**supabase.js:**
```bash
curl -L -o public/vendor/supabase.js https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js
```
Fehlt die Datei, lädt die Seite sie ersatzweise von jsDelivr. Das funktioniert, ist aber eine Datenübertragung an einen Drittanbieter.

**Schriften:**
1. Auf [gwfh.mranftl.com](https://gwfh.mranftl.com/fonts) diese drei Schriften herunterladen, jeweils nur „latin“ im Format woff2:
   - **Grenze Gotisch:** Gewicht 700
   - **Grenze:** Gewichte 500 und 600
   - **Hanken Grotesk:** Gewichte 400, 500, 600 und 700
2. Die Dateien in `public/fonts/` so benennen:
   ```
   grenze-gotisch-700.woff2
   grenze-500.woff2   grenze-600.woff2
   hanken-grotesk-400.woff2  hanken-grotesk-500.woff2  hanken-grotesk-600.woff2  hanken-grotesk-700.woff2
   ```

Ohne Schriftdateien funktioniert alles, nur mit Ersatzschriften.

### 7. Lokal testen
```bash
cd public
python3 -m http.server 8000
```
Dann `http://localhost:8000` öffnen, dich anmelden und einen Vorschlag einreichen.

### 8. Veröffentlichen (Netlify)
1. **Einfachster Weg:** auf [app.netlify.com/drop](https://app.netlify.com/drop) den Ordner `public` hineinziehen.
2. **Mit Git:** das Repository mit Netlify verbinden. `netlify.toml` stellt den Ordner schon richtig ein.
3. Danach die endgültige Adresse (oder deine eigene Domain) in Supabase eintragen, wie in Schritt 3 beschrieben.
4. Dieselbe Adresse auch als `ERLAUBTER_URSPRUNG` in Schritt 4 eintragen.

### 9. Dich zum Admin machen
Einmal auf der Website anmelden, dann im SQL Editor ausführen:
```sql
insert into public.admins (user_id)
select id from auth.users where email = 'deine@adresse.at';
```

**Was Admins zusätzlich sehen und können:**
- In der Community gibt es den Filter „Zu prüfen“.
- Vorschläge direkt aufnehmen, freigeben oder entfernen.
- Sehen, wie oft ein Vorschlag gemeldet wurde.

## So funktioniert die Community

Die Regeln stehen in der Datenbank, nicht in der Website. Man kann sie also auch mit manipulierten Anfragen nicht umgehen.

**Vorschläge und Stimmen:**
- Vorschlagen und Abstimmen geht nur angemeldet.
- Jede Person hat pro Vorschlag **eine** Stimme. Für eigene Vorschläge kann man nicht stimmen.
- Bei **20 Stimmen** setzt die Datenbank den Status automatisch auf „aufgenommen“. Der Eintrag erscheint dann in seiner Situation und in den Karteikarten.
- Stimmen für einen aufgenommenen Vorschlag lassen sich nicht mehr zurückziehen. Die Aufnahme bleibt also bestehen.
- Doppelte Einträge verhindert die Datenbank. Groß- und Kleinschreibung, Satzzeichen und å/a zählen dabei als gleich.
- **Limits pro Person:** höchstens 50 offene Vorschläge und 15 neue pro Tag.

**Schutz vor Missbrauch:**
- Ab **3 Meldungen** wird ein offener Vorschlag bis zur Prüfung ausgeblendet.
- Eigene Stimmen, E-Mail-Adressen und Lernstände anderer sind für niemanden lesbar.

**Werte ändern:**
- **Schwelle für die Aufnahme:** in `schema.sql` die Funktion `mw_schwelle()` und in `app.js` die Konstante `SCHWELLE`.
- **Schwelle für Meldungen:** in `schema.sql` die Funktion `mw_meldeschwelle()`.

## Inhalte bearbeiten

**Sätze ändern:** Die Sätze der Situationen stehen in `public/data.js`. Jede Zeile hat die Form `['Tirolerisch', 'Hochdeutsch', 'Notiz']`.

**Neue Situation:** einen Block mit neuer `id` ergänzen. Die `id` darf nur aus Kleinbuchstaben bestehen.

**Lernstände bleiben erhalten**, solange die Reihenfolge bestehender Sätze gleich bleibt. Neue Sätze deshalb am Ende einer Situation anhängen.

## Kosten

- **Supabase:** Der kostenlose Tarif reicht für den Start. Kostenlose Projekte werden nach einer Woche ohne Aufrufe pausiert. Für den Dauerbetrieb lohnt sich deshalb der Pro-Tarif.
- **Netlify:** Der kostenlose Tarif reicht für eine statische Seite dieser Größe.
- **Claude API:** Du zahlst pro Anfrage. Über `KI_TAGESLIMIT` steuerst du die Kosten. Unter [console.anthropic.com](https://console.anthropic.com) kannst du zusätzlich ein monatliches Ausgabenlimit setzen, und das solltest du auch tun.

## Vor dem Start

- [ ] `impressum.html` und `datenschutz.html` ausfüllen und prüfen lassen. Die Texte sind Entwürfe und keine Rechtsberatung.
- [ ] Auftragsverarbeitungsverträge (AVV/DPA) mit Supabase, Netlify und Anthropic abschließen.
- [ ] Eigenen SMTP-Dienst in Supabase eintragen.
- [ ] `ERLAUBTER_URSPRUNG` und ein Ausgabenlimit bei Anthropic setzen.
- [ ] Die mitgelieferten Sätze von Leuten gegenlesen lassen, die Dialekt sprechen.
