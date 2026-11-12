# Coran for Malak

App web pour lire, mémoriser et réviser le Coran (Hafs et Warsh), avec une série de lecture, les hasanat, les statistiques du jour, de la semaine, du mois et de l’année, des comptes séparés sur chaque téléphone, et des identifiants en ligne (facultatifs) pour retrouver sa progression sur un autre téléphone et voir si ses amis ont lu aujourd’hui.

Ouvre le site sur ton iPhone dans Safari, puis Partager → « Sur l’écran d’accueil » pour l’installer comme une app.

## Sources et licences

- **Texte et polices du Coran** : Complexe du Roi Fahd pour l’impression du Noble Coran (KFGQPC), Hafs et Warsh, avec le découpage du mushaf de Médine.
- **Traduction française** : Muhammad Hamidullah, version 1.0.0 publiée par QuranEnc.com, reproduite sans modification.
- **Tafsir en français** : Al-Mukhtasar, préparé par le Centre Tafsir, traduction publiée par QuranEnc.com.
- **Tafsir d’Ibn al-Qayyim** : passages classés par ayah, d’après QUL (Tarteel), via la Tafsir API.
- **Traduction anglaise** : Marmaduke Pickthall (1930), domaine public.
- **Calligraphies** : Amiri Quran (The Amiri Project Authors) et Scheherazade New (SIL Global), SIL Open Font License 1.1. Fichiers de Fontsource servis par le site lui-même, avec leurs licences dans `fonts/` (aucun appel à Google).
- **Récitations** : fichiers ayah par ayah d’[everyayah.com](https://everyayah.com), avec le miroir vérifié [Maqra](https://huggingface.co/maqra-project) en secours. Ils sont lus sans aucune modification, pour un usage non commercial (apprentissage, mémorisation). Merci aux récitateurs, dont le nom s’affiche pendant l’écoute, et à everyayah.com.
- **Heures de prière et Qibla** : calcul astronomique fait dans l’app, avec les angles publiés par chaque organisme (Ligue islamique mondiale, ISNA, Umm al-Qura, etc.). La boussole corrige le nord magnétique avec le Modèle magnétique mondial WMM2025 (NOAA et British Geological Survey, domaine public). Ta position reste sur ton téléphone.
- **Comptes en ligne** : [Supabase](https://supabase.com) (connexion et base PostgreSQL). Les règles d’accès de chaque table sont dans `supabase/schema.sql` du code source de l’app. Une tâche GitHub quotidienne (`.github/workflows/garder-en-ligne.yml`) appelle la base pour que le projet gratuit ne se mette pas en pause.
- **Mascottes et design** : Malak, Bûma et Hamâma sont des créations originales de l’app.

Le nombre de hasanat est une estimation (10 par lettre, d’après le hadith rapporté par at-Tirmidhî, n° 2910). Allah seul connaît la récompense.

Usage personnel et non commercial. Les contenus des sources gardent leurs propres licences.

App gratuite, sans publicité, sans pistage et sans cookies. Confidentialité, conditions, cookies, remboursement et contact : dans l’app, Compte → À propos. Pour nous joindre : [ouvrir une demande](https://github.com/zaimineee/coran-for-malak/issues) (public, n’y mets jamais ton mot de passe).
