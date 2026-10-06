#!/usr/bin/env bash
# Controllo prima di pubblicare: cerca chiavi e segreti nei file del repository.
# Uso (dalla cartella del progetto):  bash tools/check-secrets.sh
# Esce con errore se trova qualcosa di sospetto.
set -u
cd "$(dirname "$0")/.."

fail=0
check() { # $1 descrizione, $2 regex
  local hits
  hits=$(grep -rInE "$2" . \
    --exclude-dir=.git --exclude-dir=node_modules --exclude=check-secrets.sh \
    --exclude=supabase.js 2>/dev/null)
  if [ -n "$hits" ]; then
    echo "ATTENZIONE: $1"; echo "$hits" | sed 's/^/   /'; fail=1
  fi
}

check "chiave segreta Supabase (sb_secret_)"        'sb_secret_[A-Za-z0-9_-]{10,}'
check "chiave service_role (JWT)"                   'service_role["'"'"']?\s*[:=]|eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}'
check "chiave Ollama scritta nel codice"            'OLLAMA_API_KEY\s*[=:]\s*["'"'"'][^"'"'"'$ ]{8,}'
check "intestazione Bearer con chiave letterale"    'Bearer [A-Za-z0-9._-]{24,}'
check "chiave Google API"                           'AIza[0-9A-Za-z_-]{35}'
check "chiave privata"                              'BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY'
check "token GitHub"                                'gh[pousr]_[A-Za-z0-9]{30,}'

# File che non devono esistere nel repository
for f in $(find . -name ".env*" -not -path "./.git/*" 2>/dev/null); do echo "ATTENZIONE: file $f presente"; fail=1; done

# Il frontend non deve mai contenere riferimenti diretti a Ollama
if grep -rIn "ollama.com" js/ index.html sw.js 2>/dev/null; then echo "ATTENZIONE: il frontend chiama Ollama direttamente"; fail=1; fi

# config.js: ammessa solo la chiave pubblicabile
if grep -vE '^\s*//' js/config.js | grep -qE "sb_secret_|service_role|eyJ"; then echo "ATTENZIONE: js/config.js contiene una chiave segreta"; fail=1; fi

if [ $fail -eq 0 ]; then echo "OK: nessuna chiave o segreto trovato."; fi
exit $fail
