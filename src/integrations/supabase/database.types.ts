// Ce fichier était une ancienne version partielle (5 tables Phase 1).
// Désormais on re-export le type Database complet depuis `types.ts` (généré
// par Supabase, 53+ tables). Ça élimine la cause racine des 141+ `as any`
// dans les server functions.
export type { Database, Json } from "./types";
