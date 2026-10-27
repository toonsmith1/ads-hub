#!/usr/bin/env bash
# ทดสอบ supabase/schema.sql บน Postgres ในเครื่อง (ไม่ต้องมี Supabase)
# จำลองส่วนของ Supabase ที่ schema ใช้: role anon/authenticated/service_role, auth.uid() และ schema storage
# รัน: bash tests/db-test.sh   (ต้องมี Postgres 14+ ติดตั้งอยู่ เช่น /usr/lib/postgresql/16/bin)
set -euo pipefail
cd "$(dirname "$0")/.."
PGBIN=${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}
DIR=$(mktemp -d)
chmod 777 "$DIR"
RUN=(); [ "$(id -u)" = 0 ] && RUN=(runuser -u postgres --)
"${RUN[@]}" "$PGBIN/initdb" -D "$DIR/data" -A trust -U postgres -E UTF8 --locale=C.UTF-8 >/dev/null
"${RUN[@]}" "$PGBIN/pg_ctl" -D "$DIR/data" -o "-k $DIR -p 54329 -c listen_addresses=''" -l "$DIR/log" -w start >/dev/null
trap '"${RUN[@]}" "$PGBIN/pg_ctl" -D "$DIR/data" -m immediate stop >/dev/null; rm -rf "$DIR"' EXIT
export PGOPTIONS="-c client_min_messages=warning"
PSQL=("$PGBIN/psql" -h "$DIR" -p 54329 -U postgres -d postgres -v ON_ERROR_STOP=1 -q -X)

"${PSQL[@]}" <<'SQL'
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated;
SQL
# รันสองรอบ: ต้องรันซ้ำได้โดยไม่พัง
"${PSQL[@]}" -f supabase/schema.sql >/dev/null
"${PSQL[@]}" -f supabase/schema.sql >/dev/null
"${PSQL[@]}" -f tests/db-test.sql
echo "db-test: ผ่านทั้งหมด"
