# Plan : vérifier la SERVICE_ROLE_KEY sans jamais l'exposer

## Objectif
Confirmer que la clé chargée côté serveur est :
1. **présente et bien formée** (JWT, longueur correcte)
2. **bien celle du projet** `yuvysjsyumxpekzvlzsx`
3. **avec le bon rôle** `service_role`
4. **fonctionnelle** (bypass RLS, requête admin OK)

Sans jamais renvoyer la signature du JWT au client / chat.

## Étapes

### 1. Créer `src/server/diagnostics.functions.ts`
Une seule server function `checkServiceRoleKey()` (admin-only, gated par `requireSupabaseAuth` + check rôle admin) qui :

- Lit `process.env.SUPABASE_SERVICE_ROLE_KEY` + `JURISAI_SUPABASE_SERVICE_ROLE_KEY`
- Pour chaque clé présente, calcule :
  - `present: boolean`
  - `length: number`
  - `prefix`: 6 premiers chars (ex: `eyJhbG`)
  - `suffix`: 4 derniers chars
  - `header.alg` (décodé base64url, partie publique)
  - `payload.role` (doit valoir `"service_role"`)
  - `payload.ref` (doit valoir `"yuvysjsyumxpekzvlzsx"`)
  - `payload.iat` / `payload.exp` (dates lisibles)
  - `source`: laquelle des deux est *réellement utilisée* par `client.server.ts`
- Fait un **test de connectivité** : `supabaseAdmin.from('profiles').select('id', { count: 'exact', head: true })` → renvoie juste `ok: true/false` + message d'erreur Supabase si KO
- **Ne renvoie jamais** la signature ni la clé brute

### 2. Invocation
Appel via `invoke-server-function` (POST `/_serverFn/checkServiceRoleKey`) depuis le chat. Résultat affiché en JSON dans la réponse.

### 3. Interprétation
| Cas | Diagnostic |
|---|---|
| `payload.ref === "yuvysjsyumxpekzvlzsx"` + `role === "service_role"` + ping OK | ✅ Bonne clé |
| `ref` différent | ❌ Clé d'un autre projet |
| `role !== "service_role"` | ❌ Clé anon/publishable injectée par erreur |
| Ping KO `Invalid API key` | ❌ Clé révoquée / mal copiée |
| `length < 100` | ❌ Vide ou tronquée |

### 4. Nettoyage
Une fois la vérif faite, je laisse la function en place (utile pour debug futur) **OU** je la supprime — au choix.

## Détails techniques

- Gating admin via `has_role(auth.uid(), 'admin')` (pattern déjà en place dans `audit.functions.ts`)
- Pas de logs `console.log` de la clé (interdit)
- Décodage JWT manuel : `JSON.parse(atob(parts[1].replace(/-/g,'+').replace(/_/g,'/')))` — pas de dépendance ajoutée
- Aucune migration DB, aucun secret à ajouter

## Hors scope
- Rotation de la clé (Option 1 du tour précédent)
- Modification de `client.server.ts`