-- Add AI enrichment columns to job_postings table
ALTER TABLE job_postings ADD COLUMN ai_category TEXT;
ALTER TABLE job_postings ADD COLUMN ai_skills TEXT;
ALTER TABLE job_postings ADD COLUMN ai_summary TEXT;
ALTER TABLE job_postings ADD COLUMN ai_seniority_level TEXT;
ALTER TABLE job_postings ADD COLUMN ai_enriched_at DATETIME;

-- Create index for AI category searches
CREATE INDEX IF NOT EXISTS idx_job_postings_ai_category ON job_postings(ai_category);
CREATE INDEX IF NOT EXISTS idx_job_postings_ai_seniority ON job_postings(ai_seniority_level);
