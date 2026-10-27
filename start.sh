#!/bin/sh
# Start-up for the deployed app: bring the database up to date, make sure the admin login exists, then serve.
set -e
flask --app main:app db upgrade
flask --app main:app ensure-admin
exec gunicorn main:app --bind "0.0.0.0:${PORT:-10000}" --workers 2 --timeout 180
