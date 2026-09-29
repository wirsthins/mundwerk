// Mundwerk – Verbindung zu Supabase
// Beide Werte findest du in Supabase unter Project Settings → API.
// Der "anon public"-Schlüssel darf öffentlich sein; die Datenbank schützt sich über ihre Regeln.
// Bleiben die Felder leer, läuft die App ohne Konto, Community und KI (nur im Browser gespeichert).
window.MUNDWERK_CONFIG = {
  supabaseUrl: "",       // z. B. "https://abcdefgh.supabase.co"
  supabaseAnonKey: "",   // der lange "anon public"-Schlüssel
  dialekt: "tirol"
};
