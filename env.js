/* ============================================================
   env.js — Variables d'environnement pour La fabrique
   
   EN LOCAL : renomme ce fichier en "env.js" et remplis les valeurs
   EN PROD (Vercel) :
     1. Va dans Vercel → ton projet → Settings → Environment Variables
     2. Ajoute :  SUPABASE_URL        = https://mrivfwlxnmtgkifjucvd.supabase.co
                  SUPABASE_ANON_KEY   = eyJhbGciOiJIU...
     3. Dans vercel.json, ajoute une Build Command qui génère ce fichier :
        "buildCommand": "echo \"window.__env={SUPABASE_URL:'$SUPABASE_URL',SUPABASE_ANON_KEY:'$SUPABASE_ANON_KEY'};\" > env.js"
   ============================================================ */
const supabase = window.supabase.createClient(
   SUPABASE_URL:      'https://mrivfwlxnmtgkifjucvd.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1yaXZmd2x4bm10Z2tpZmp1Y3ZkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgyMTYzMjQsImV4cCI6MjA5Mzc5MjMyNH0.6u1Ki6MTH14tlIUsegfNKo7BuVceBDgUhTnLUcirdVk'
};
