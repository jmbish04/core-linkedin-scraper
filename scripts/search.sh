#!/usr/bin/env bash
set -euo pipefail

# Environment overrides (comma-separated):
#   ROLE_CSV, LOCATION_CSV, MODES, LIMIT, PAGE, DATE, SORT
: "${ROLE_CSV:=product management,legal operations,business intelligence}"
: "${LOCATION_CSV:=San Francisco,United States}"
: "${MODES:=on site,hybrid,remote}"
: "${LIMIT:=25}"
: "${PAGE:=0}"
: "${DATE:=past week}"
: "${SORT:=recent}"

node - <<'NODE'
const linkedIn = require('./index.js');

function env(name, def){ return (process.env[name]||def); }
const roles = env('ROLE_CSV','product management,legal operations,business intelligence').split(',').map(s=>s.trim()).filter(Boolean);
const locations = env('LOCATION_CSV','San Francisco,United States').split(',').map(s=>s.trim()).filter(Boolean);
const modes = env('MODES','on site,hybrid,remote').split(',').map(s=>s.trim()).filter(Boolean);

const base = {
  dateSincePosted: env('DATE','past week'),
  jobType: 'full time',
  sortBy: env('SORT','recent'),
  limit: env('LIMIT','25'),
  page: env('PAGE','0'),
  has_verification: false,
  under_10_applicants: false,
};

const combos = [];
for (const r of roles) {
  for (const l of locations) {
    for (const m of modes) {
      combos.push({ ...base, keyword: r, location: l, remoteFilter: m });
    }
  }
}

(async () => {
  const all = [];
  for (const opts of combos) {
    try {
      const res = await linkedIn.query(opts);
      all.push(...res);
    } catch (e) {
      console.error('Query failed:', opts, e.message);
    }
  }
  console.log(JSON.stringify(all, null, 2));
})();
NODE

chmod +x scripts/search.sh
