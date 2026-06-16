# La fabrique — notes pour Claude Code

App statique HTML/CSS/JS vanilla (pas de build) : `index.html`, `style.css`, `app.js`, backend Supabase.

## Parité visuelle avec idee (IMPORTANT)

La-fabrique et `supershivas/idee` doivent avoir **exactement la même sidebar**
(espacements, dividers, tailles d'icônes, hauteurs de bouton, etc.) — seul le
contenu/la fonction change. Si tu modifies un style de sidebar ici, vérifie
toujours son équivalent dans idee (`app/app/App.tsx`, `app/app/components/*.tsx`,
`app/globals.css`) et applique le même changement des deux côtés dans la même
session/PR. Ne jamais laisser les deux divergre.

Piège déjà rencontré : les couleurs sidebar (`--sidebar-bg`, `--sidebar-border`,
etc.) doivent rester fixes, indépendantes du thème clair/sombre de l'app — la
sidebar est "toujours sombre" dans les deux apps. Ne pas ajouter d'override
dans `[data-theme="dark"]` pour ces variables.

## Design tokens

Source de vérité canonique : `supershivas/design-system` (`design-tokens.json`).
Toute valeur partagée (couleurs sidebar, radii, fonts, dimensions
search/kbd/header/divider) doit être modifiée **là-bas en premier**, puis
synchronisée ici via `./scripts/sync-tokens.sh`, puis reportée dans le CSS qui
la consomme (`style.css`). Ne jamais modifier une valeur partagée uniquement
ici sans la reporter dans design-system et dans idee.

## Fonctionnalité Corbeille (trashed)

Les projets/sous-projets supportent un soft-delete via le champ `trashed`
(booléen). **Cela nécessite que les tables Supabase `projects` et
`subprojects` aient une colonne `trashed boolean default false`** — il n'y a
pas d'outil de migration dans ce repo, la colonne doit être ajoutée
manuellement côté Supabase si ce n'est pas déjà fait.

## Workflow Git

- Toujours brancher depuis `main`, jamais commit direct sur `main`.
- Commits descriptifs en français.
- Une fois la branche poussée : créer une PR vers `main`, puis squash-merge
  (`merge_method: "squash"`). C'est le pattern utilisé pour tout ce repo.
