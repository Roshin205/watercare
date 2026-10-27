#!/bin/sh
# Start-up for the deployed app: bring the database up to date, make sure the admin login exists, then serve.
set -e
echo "WaterCare start-up 1/3: updating the database tables"
if ! flask --app main:app db upgrade; then
  echo "WaterCare start-up FAILED at the database step. Check DATABASE_URL (Supabase Session pooler address,"
  echo "real password without [ ], ending ?sslmode=require), SECRET_KEY and FLASK_ENV in the Environment settings."
  exit 1
fi
echo "WaterCare start-up 2/3: checking the admin login"
flask --app main:app ensure-admin || echo "WaterCare start-up: admin check failed; the app will still start."
echo "WaterCare start-up 3/3: starting the web server"
exec gunicorn main:app --bind "0.0.0.0:${PORT:-10000}" --workers 2 --timeout 180
