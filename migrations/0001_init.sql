CREATE TABLE IF NOT EXISTS search_profiles (
    id TEXT PRIMARY KEY,
    profile_name TEXT NOT NULL,
    keywords TEXT NOT NULL,
    locations TEXT NOT NULL,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS job_postings (
    job_urn TEXT PRIMARY KEY,
    position TEXT,
    company TEXT,
    location TEXT,
    salary TEXT,
    job_url TEXT,
    company_logo_url TEXT,
    posted_time_text TEXT,
    posted_date TEXT,
    insights TEXT,
    search_keyword TEXT NOT NULL,
    search_location TEXT NOT NULL,
    last_scraped_at DATETIME DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS action_logs (
    id TEXT PRIMARY KEY,
    timestamp DATETIME DEFAULT (datetime('now')),
    action_type TEXT NOT NULL,
    status TEXT NOT NULL,
    message TEXT,
    metadata TEXT
);
