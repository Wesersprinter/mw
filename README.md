# Maschenwerk – Einrichtung

Maschenwerk ist eine Web-App, die sich wie eine normale App installieren lässt (PWA). Jede Person öffnet einen Link, tippt auf „Zum Home-Bildschirm“ und hat danach ein eigenes App-Symbol. Die App läuft auch offline.

- **Ohne Konto:** Alles bleibt auf dem jeweiligen Gerät.
- **Mit Konto:** Projekte, Anleitungen, Fotos und PDFs sind auf Handy, Tablet und Notebook gleich. Jede Person sieht nur ihre eigenen Daten.

Für die Konten brauchst du ein kostenloses Supabase-Projekt, für die Adresse ein kostenloses GitHub-Konto. Beides dauert zusammen etwa 20 Minuten.

---

## 1. Supabase einrichten (Konten und Abgleich)

1. Auf **supabase.com** registrieren und **New project** anlegen.
   - Name: `maschenwerk`
   - Region: **Central EU (Frankfurt)**
   - Datenbank-Passwort: generieren lassen und sicher ablegen (die App braucht es nicht).
2. Links **SQL Editor** → **New query**. Den kompletten Inhalt von `supabase/schema.sql` einfügen und **Run** klicken. Es sollte „Success. No rows returned“ erscheinen.
3. **Authentication → Sign In / Providers → Email**
   - „Enable Email provider“ bleibt an.
   - **„Confirm email“ ausschalten.** Sonst müsste Supabase bei jeder Anmeldung eine Bestätigungsmail schicken, und ohne eigenen Mailserver verschickt Supabase nur an Mitglieder deines Teams, höchstens 2 Mails pro Stunde.
4. **Authentication → URL Configuration**
   - Site URL: deine spätere App-Adresse, z. B. `https://DEINNAME.github.io/maschenwerk/`
   - Dieselbe Adresse zusätzlich unter **Redirect URLs** eintragen.
5. Die beiden Zugangswerte holen und in **`config.js`** eintragen:
   - **Project URL**: oben auf **Connect** klicken oder unter Project Settings → Data API, z. B. `https://abcdefghijklmnop.supabase.co`
   - **Publishable key**: Project Settings → **API Keys**, beginnt mit `sb_publishable_`

   ```js
   window.MASCHENWERK_CONFIG = {
     supabaseUrl: "https://abcdefghijklmnop.supabase.co",
     supabaseKey: "sb_publishable_…",
     operator: "Henning Haye"
   };
   ```
   Der Publishable key ist für den Browser gedacht und darf öffentlich sein. Wer welche Daten lesen darf, regeln die Zugriffsregeln aus `schema.sql`. Den **Secret key** niemals in die App eintragen.

## 2. Auf GitHub Pages veröffentlichen

1. Auf **github.com** ein Konto anlegen und oben rechts **+ → New repository** wählen.
   - Name: `maschenwerk`, Sichtbarkeit **Public** (für kostenlose GitHub Pages nötig), dann **Create repository**.
2. Auf der leeren Repository-Seite **„uploading an existing file“** anklicken.
3. Den **Inhalt** des entpackten Ordners `maschenwerk` (nicht den Ordner selbst) ins Browserfenster ziehen: `index.html`, `app.js`, die Ordner `vendor`, `fonts`, `icons`, `supabase` usw. Unten **Commit changes**.
4. **Settings → Pages**: unter „Build and deployment“ Source **Deploy from a branch**, Branch **main** und **/(root)**, **Save**.
5. Nach ein bis zwei Minuten ist die App erreichbar unter `https://DEINNAME.github.io/maschenwerk/`.

## 3. Deine bisherigen Daten übernehmen

Die Datei `maschenwerk-sicherung-….json` enthält deine Projekte, Anleitungen, Garne und Maschenproben aus der bisherigen Version.

1. App öffnen → **Werkzeug → Mehr → Anmelden oder Konto anlegen** → neues Konto anlegen.
2. **Werkzeug → Mehr → Sicherung einspielen** → die JSON-Datei wählen.
3. Auf Notebook und Tablet die App öffnen und mit demselben Konto anmelden. Die Daten erscheinen dort automatisch.

## 4. An andere Stricker weitergeben

Schick einfach den Link. So wird daraus eine App:

- **iPhone / iPad:** in **Safari** öffnen → **Teilen** → **Zum Home-Bildschirm**.
- **Android:** in **Chrome** öffnen → Menü → **App installieren** (oder der Hinweis „Installieren“ in der App).
- **Notebook (Chrome / Edge):** rechts in der Adresszeile das Installieren-Symbol.

Jede Person legt in der App ihr eigenes Konto an oder nutzt sie ohne Konto.

**Neue Anmeldungen sperren** (falls nur bestimmte Leute die App nutzen sollen): Authentication → Sign In / Providers → „Allow new users to sign up“ ausschalten. Neue Personen legst du dann unter **Authentication → Users → Add user → Create new user** mit E-Mail, Startpasswort und „Auto Confirm User“ an.

## 5. Updates einspielen

Neue Dateien wie in Schritt 2 hochladen und vorhandene überschreiben, **aber `config.js` weglassen**, damit deine Zugangswerte bleiben. Beim nächsten Öffnen meldet die App „Eine neue Version ist da“ mit dem Knopf **Aktualisieren**.

## 6. Kosten und Grenzen

Der kostenlose Supabase-Tarif reicht für einen Strickkreis gut aus:

- 500 MB Datenbank (Projekte und Anleitungstexte brauchen wenig Platz)
- 1 GB Dateispeicher für PDFs und Fotos, einzelne Dateien bis 20 MB
- 5 GB Datenverkehr pro Monat, bis 50.000 aktive Nutzer
- **Ein kostenloses Projekt pausiert nach einer Woche ohne jede Nutzung.** Die Daten bleiben erhalten; im Supabase-Dashboard lässt es sich mit einem Klick wieder starten. Solange jemand die App regelmäßig nutzt, passiert das nicht.

Wird es mehr, kostet der Pro-Tarif 25 $ im Monat. GitHub Pages ist kostenlos.

## 7. Passwort vergessen

„Neues Passwort anfordern“ in der App verschickt eine E-Mail. Das funktioniert für alle erst, wenn ein eigener Mailserver eingetragen ist: **Authentication → Emails → SMTP Settings**, z. B. mit dem kostenlosen Tarif von Brevo.

Bis dahin kannst du ein Passwort im SQL Editor selbst neu setzen:

```sql
update auth.users
set encrypted_password = extensions.crypt('NeuesPasswort123', extensions.gen_salt('bf'))
where email = 'person@example.de';
```

## 8. Rechtliches

- **Datenschutzerklärung:** `datenschutz.html` ist eine Vorlage. Die gelb markierten Stellen (Name, Anschrift, E-Mail, Datum) ausfüllen und den Text prüfen. Sie ist in der App verlinkt.
- **Auftragsverarbeitung:** Mit Supabase einen Auftragsverarbeitungsvertrag (DPA) abschließen, Supabase stellt ihn unter supabase.com/legal/dpa bereit.
- **Impressum:** Nach § 5 DDG gilt die Impressumspflicht für geschäftsmäßige, in der Regel gegen Entgelt angebotene digitale Dienste. Für eine kostenlose App im Bekanntenkreis ist das meist nicht der Fall; wer sie öffentlich bewirbt, sollte eines ergänzen.
- Die Vorlage ist kein Rechtsrat.

## 9. Technik in Kürze

- **Lokal zuerst:** Jede Änderung wird sofort im Browser gespeichert (Local Storage, Dateien in IndexedDB) und mit Konto im Hintergrund in die Tabelle `items` übertragen. Bei Konflikten gewinnt der jüngere Stand. Offline gemachte Änderungen werden nachgeholt.
- **Zugriffsschutz:** Row Level Security in der Datenbank und Ordnerregeln im Dateispeicher. Jede Person kommt nur an ihre eigenen Zeilen und Dateien.
- **Live-Abgleich:** Supabase Realtime, zusätzlich Abgleich beim Öffnen und alle 45 Sekunden.
- **Offline:** Ein Service Worker hält die App-Dateien vor. Schriften und Bibliotheken liegen in der App selbst, es gibt keine Aufrufe zu Google oder anderen Servern.
- **Eigene Supabase-Domain:** Wer statt `*.supabase.co` eine eigene Domain nutzt, muss sie in `index.html` in der Zeile `Content-Security-Policy` unter `connect-src` ergänzen.
