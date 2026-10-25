/* Maschenwerk – Einstellungen für deine Installation.
   Die beiden Werte findest du in Supabase unter
   Project Settings → API Keys (Project URL und Publishable key).
   Der Publishable key darf öffentlich sein: Wer welche Daten sieht,
   regeln die Zugriffsregeln in der Datenbank (supabase/schema.sql).
   Bleiben die Felder leer, läuft die App ohne Konto, nur auf dem Gerät. */
window.MASCHENWERK_CONFIG = {
  supabaseUrl: "",        // z. B. "https://abcdefghijklmnop.supabase.co"
  supabaseKey: "",        // z. B. "sb_publishable_..."
  operator: ""            // optional, erscheint unten in Werkzeug → Mehr, z. B. "Henning Haye"
};
