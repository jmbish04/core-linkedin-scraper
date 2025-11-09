import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { stringify as stringifyYaml } from 'yaml';
import { load } from 'cheerio';

export { JobsWebSocket } from './websocket';

const DEFAULT_ROLES = [
  'Data Engineer',
  'AI PM',
  'Legal Program Manager',
];

const DEFAULT_LOCATIONS = [
  'San Francisco Bay Area',
  'Remote',
];

const ONE_HOUR = 60 * 60;

const SCRAPE_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: 'https://www.linkedin.com/jobs',
  Connection: 'keep-alive',
};

type LogStatus = 'success' | 'error' | 'info';

type Bindings = {
  DB: D1Database;
  ASSETS: Fetcher;
  AI: Ai;
  JOBS_WEBSOCKET: DurableObjectNamespace;
};

type Variables = Record<string, never>;

type WorkerEnv = {
  Bindings: Bindings;
  Variables: Variables;
};

interface SearchProfileRow {
  id: string;
  profile_name: string;
  keywords: string;
  locations: string;
  is_active: number;
  created_at: string;
}

interface SearchProfile {
  id: string;
  profile_name: string;
  keywords: string[];
  locations: string[];
  is_active: number;
  created_at: string;
}

interface JobPostingRow {
  job_urn: string;
  position: string | null;
  company: string | null;
  location: string | null;
  salary: string | null;
  job_url: string | null;
  company_logo_url: string | null;
  posted_time_text: string | null;
  posted_date: string | null;
  insights: string | null;
  search_keyword: string;
  search_location: string;
  last_scraped_at: string | null;
  ai_category: string | null;
  ai_skills: string | null;
  ai_summary: string | null;
  ai_seniority_level: string | null;
  ai_enriched_at: string | null;
}

interface JobPostingRecord {
  job_urn: string;
  position: string;
  company: string;
  location: string;
  salary: string;
  job_url: string;
  company_logo_url: string;
  posted_time_text: string;
  posted_date: string;
  insights: string;
  search_keyword: string;
  search_location: string;
  ai_category?: string;
  ai_skills?: string[];
  ai_summary?: string;
  ai_seniority_level?: string;
  ai_enriched_at?: string;
}

interface ActionLogRow {
  id: string;
  timestamp: string;
  action_type: string;
  status: string;
  message: string | null;
  metadata: string | null;
}

class Query {
  private readonly host: string;

  private readonly keyword: string;

  private readonly location: string;

  private readonly dateSincePosted: string;

  private readonly jobType: string;

  private readonly remoteFilter: string;

  private readonly salary: string | number;

  private readonly experienceLevel: string;

  private readonly sortBy: string;

  private readonly limit: number;

  private readonly page: number;

  private readonly hasVerification: boolean;

  private readonly under10Applicants: boolean;

  constructor(input: Partial<QueryOptions> = {}) {
    this.host = input.host ?? 'www.linkedin.com';
    this.keyword = sanitizeQueryParam(input.keyword);
    this.location = sanitizeQueryParam(input.location);
    this.dateSincePosted = input.dateSincePosted ?? '';
    this.jobType = input.jobType ?? '';
    this.remoteFilter = input.remoteFilter ?? '';
    this.salary = input.salary ?? '';
    this.experienceLevel = input.experienceLevel ?? '';
    this.sortBy = input.sortBy ?? '';
    this.limit = Number(input.limit ?? 0);
    this.page = Number.isFinite(input.page) ? Number(input.page) : 0;
    this.hasVerification = Boolean(input.has_verification);
    this.under10Applicants = Boolean(input.under_10_applicants);
  }

  url(start = 0): string {
    const baseUrl = `https://${this.host}/jobs-guest/jobs/api/seeMoreJobPostings/search?`;
    const params = new URLSearchParams();

    if (this.keyword) params.append('keywords', this.keyword);
    if (this.location) params.append('location', this.location);

    const posted = this.getDateSincePosted();
    if (posted) params.append('f_TPR', posted);

    const salary = this.getSalary();
    if (salary) params.append('f_SB2', salary);

    const experience = this.getExperienceLevel();
    if (experience) params.append('f_E', experience);

    const remote = this.getRemoteFilter();
    if (remote) params.append('f_WT', remote);

    const jobType = this.getJobType();
    if (jobType) params.append('f_JT', jobType);

    if (this.hasVerification) params.append('f_VJ', 'true');
    if (this.under10Applicants) params.append('f_EA', 'true');

    params.append('start', String(start + this.getPage()));

    if (this.sortBy === 'recent') params.append('sortBy', 'DD');
    else if (this.sortBy === 'relevant') params.append('sortBy', 'R');

    if (this.limit > 0) params.append('count', String(this.limit));

    return `${baseUrl}${params.toString()}`;
  }

  private getDateSincePosted(): string {
    const range: Record<string, string> = {
      'past month': 'r2592000',
      'past week': 'r604800',
      '24hr': 'r86400',
    };

    return range[this.dateSincePosted.toLowerCase?.() ?? ''] ?? '';
  }

  private getExperienceLevel(): string {
    const experienceMap: Record<string, string> = {
      internship: '1',
      'entry level': '2',
      associate: '3',
      senior: '4',
      director: '5',
      executive: '6',
    };

    return experienceMap[this.experienceLevel.toLowerCase?.() ?? ''] ?? '';
  }

  private getJobType(): string {
    const jobTypeMap: Record<string, string> = {
      'full time': 'F',
      'full-time': 'F',
      'part time': 'P',
      'part-time': 'P',
      contract: 'C',
      temporary: 'T',
      volunteer: 'V',
      internship: 'I',
    };

    return jobTypeMap[this.jobType.toLowerCase?.() ?? ''] ?? '';
  }

  private getRemoteFilter(): string {
    const remoteMap: Record<string, string> = {
      'on-site': '1',
      'on site': '1',
      remote: '2',
      hybrid: '3',
    };

    return remoteMap[this.remoteFilter.toLowerCase?.() ?? ''] ?? '';
  }

  private getSalary(): string {
    const salaryMap: Record<string, string> = {
      40000: '1',
      60000: '2',
      80000: '3',
      100000: '4',
      120000: '5',
    };

    return salaryMap[String(this.salary)] ?? '';
  }

  private getPage(): number {
    return this.page * 25;
  }
}

interface QueryOptions {
  host: string;
  keyword: string;
  location: string;
  dateSincePosted: string;
  jobType: string;
  remoteFilter: string;
  salary: string | number;
  experienceLevel: string;
  sortBy: string;
  limit: number;
  page: number;
  has_verification: boolean;
  under_10_applicants: boolean;
}

function sanitizeQueryParam(value?: string | null): string {
  if (!value) return '';
  return value.trim().replace(/\s+/g, '+');
}

function parseArrayInput(value: unknown, fallback: string[] = []): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim()).filter(Boolean);
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return fallback;

    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map((entry) => String(entry).trim()).filter(Boolean);
      }
    } catch (error) {
      // Ignore JSON parse failure and treat as comma-separated list.
    }

    return trimmed
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  return fallback;
}

async function logAction(
  env: Bindings,
  actionType: string,
  status: LogStatus,
  message?: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  try {
    const serializedMetadata = metadata ? JSON.stringify(metadata) : null;
    await env.DB.prepare(
      `INSERT INTO action_logs (id, action_type, status, message, metadata) VALUES (?, ?, ?, ?, ?)`
    )
      .bind(crypto.randomUUID(), actionType, status, message ?? null, serializedMetadata)
      .run();
  } catch (error) {
    console.error('Failed to write action log', error);
  }
}

function parseJobs(html: string, searchKeyword: string, searchLocation: string): JobPostingRecord[] {
  const $ = load(html);
  const jobs: JobPostingRecord[] = [];

  $('li').each((_, element) => {
    const job = $(element);
    const position = job.find('.base-search-card__title').text().trim();
    const company = job.find('.base-search-card__subtitle').text().trim();
    const location = job.find('.job-search-card__location').text().trim();
    const salary = job
      .find('.job-search-card__salary-info')
      .text()
      .trim()
      .replace(/\s+/g, ' ');
    const jobUrl = job.find('.base-card__full-link').attr('href') ?? '';
    const absoluteJobUrl = jobUrl
      ? jobUrl.startsWith('http')
        ? jobUrl
        : new URL(jobUrl, 'https://www.linkedin.com').toString()
      : '';
    const companyLogo = job.find('.artdeco-entity-image').attr('data-delayed-url') ?? '';
    const postedTimeText = job.find('.job-search-card__listdate').text().trim();
    const postedDate = job.find('time').attr('datetime') ?? '';
    const jobUrn = job.attr('data-entity-urn') ?? '';
    const insights = job.find('.result-benefits__text').text().trim();

    if (!position || !company || !jobUrn) {
      return;
    }

    jobs.push({
      job_urn: jobUrn,
      position,
      company,
      location: location || 'Not specified',
      salary: salary || 'Not specified',
      job_url: absoluteJobUrl,
      company_logo_url: companyLogo,
      posted_time_text: postedTimeText,
      posted_date: postedDate,
      insights,
      search_keyword: searchKeyword,
      search_location: searchLocation,
    });
  });

  return jobs;
}

interface AIEnrichmentResult {
  category: string;
  skills: string[];
  summary: string;
  seniority_level: string;
}

async function enrichJobWithAI(env: Bindings, job: JobPostingRecord): Promise<AIEnrichmentResult> {
  const prompt = `Analyze this job posting and extract the following information in JSON format:
- category: The job category (e.g., "Software Engineering", "Data Science", "Product Management", "Sales", "Marketing", etc.)
- skills: Array of technical skills or tools mentioned (e.g., ["Python", "SQL", "AWS"])
- summary: A brief 1-2 sentence summary of the role
- seniority_level: The seniority level (e.g., "Entry", "Mid", "Senior", "Lead", "Executive")

Job Details:
Position: ${job.position}
Company: ${job.company}
Location: ${job.location}
Insights: ${job.insights || 'N/A'}

Respond ONLY with valid JSON, no additional text.`;

  try {
    const response = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [
        {
          role: 'system',
          content:
            'You are a job posting analyzer. Respond only with valid JSON matching the requested schema.',
        },
        { role: 'user', content: prompt },
      ],
      max_tokens: 500,
    });

    if (typeof response !== 'object' || !response || !('response' in response) || typeof response.response !== 'string') {
      throw new Error('Unexpected AI response format: ' + JSON.stringify(response));
    }
    const text = response.response;
    const cleanText = text
      .trim()
      .replace(/^```json\s*/, '')
      .replace(/^```\s*/, '')
      .replace(/```\s*$/, '');

    const parsed = JSON.parse(cleanText);

    return {
      category: parsed.category || 'Uncategorized',
      skills: Array.isArray(parsed.skills) ? parsed.skills : [],
      summary: parsed.summary || '',
      seniority_level: parsed.seniority_level || 'Not specified',
    };
  } catch (error) {
    console.error('AI enrichment failed:', error);
    return {
      category: 'Uncategorized',
      skills: [],
      summary: '',
      seniority_level: 'Not specified',
    };
  }
}

async function runScrape(env: Bindings, searchKeyword: string, searchLocation: string): Promise<JobPostingRecord[]> {
  const metadata = { keyword: searchKeyword, location: searchLocation };
  await logAction(env, 'scrape_run_start', 'info', 'Scrape started', metadata);

  try {
    const query = new Query({ keyword: searchKeyword, location: searchLocation });
    const cache = caches.default;
    const cacheKey = new Request(query.url(0));
    let response = await cache.match(cacheKey);
    let html: string;

    if (!response) {
      const fetched = await fetch(query.url(0), { headers: SCRAPE_HEADERS });
      if (!fetched.ok) {
        throw new Error(`LinkedIn responded with status ${fetched.status}`);
      }

      html = await fetched.text();
      const cachedResponse = new Response(html, {
        headers: {
          'Cache-Control': `max-age=${ONE_HOUR}`,
          'Content-Type': 'text/html; charset=utf-8',
        },
      });
      await cache.put(cacheKey, cachedResponse);
    } else {
      html = await response.text();
    }

    const jobs = parseJobs(html, searchKeyword, searchLocation);
    const nowIso = new Date().toISOString();

    // Enrich jobs with AI
    const enrichedJobs = await Promise.all(
      jobs.map(async (job) => {
        const enrichment = await enrichJobWithAI(env, job);
        return {
          ...job,
          ai_category: enrichment.category,
          ai_skills: enrichment.skills,
          ai_summary: enrichment.summary,
          ai_seniority_level: enrichment.seniority_level,
          ai_enriched_at: nowIso,
        };
      })
    );

    const statement = env.DB.prepare(
      `INSERT OR REPLACE INTO job_postings (
        job_urn, position, company, location, salary, job_url, company_logo_url,
        posted_time_text, posted_date, insights, search_keyword, search_location, last_scraped_at,
        ai_category, ai_skills, ai_summary, ai_seniority_level, ai_enriched_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const statements = enrichedJobs.map((job) =>
      statement.bind(
        job.job_urn,
        job.position,
        job.company,
        job.location,
        job.salary,
        job.job_url,
        job.company_logo_url,
        job.posted_time_text,
        job.posted_date,
        job.insights,
        job.search_keyword,
        job.search_location,
        nowIso,
        job.ai_category,
        job.ai_skills ? JSON.stringify(job.ai_skills) : null,
        job.ai_summary,
        job.ai_seniority_level,
        job.ai_enriched_at
      )
    );
    if (statements.length > 0) {
      await env.DB.batch(statements);
    }

    await logAction(env, 'scrape_run_success', 'success', 'Scrape completed', {
      ...metadata,
      inserted: enrichedJobs.length,
    });

    return enrichedJobs;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown scrape failure';
    await logAction(env, 'scrape_run_error', 'error', message, {
      ...metadata,
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }
}

function mapProfileRow(row: SearchProfileRow): SearchProfile {
  return {
    id: row.id,
    profile_name: row.profile_name,
    keywords: parseArrayInput(row.keywords, []),
    locations: parseArrayInput(row.locations, []),
    is_active: row.is_active,
    created_at: row.created_at,
  };
}

function mapJobRow(row: JobPostingRow): JobPostingRow & { ai_skills_parsed?: string[] } {
  let aiSkillsParsed: string[] = [];
  if (row.ai_skills) {
    try {
      aiSkillsParsed = JSON.parse(row.ai_skills);
    } catch {
      aiSkillsParsed = [];
    }
  }

  return {
    job_urn: row.job_urn,
    position: row.position,
    company: row.company,
    location: row.location,
    salary: row.salary,
    job_url: row.job_url,
    company_logo_url: row.company_logo_url,
    posted_time_text: row.posted_time_text,
    posted_date: row.posted_date,
    insights: row.insights,
    search_keyword: row.search_keyword,
    search_location: row.search_location,
    last_scraped_at: row.last_scraped_at,
    ai_category: row.ai_category,
    ai_skills: row.ai_skills,
    ai_skills_parsed: aiSkillsParsed,
    ai_summary: row.ai_summary,
    ai_seniority_level: row.ai_seniority_level,
    ai_enriched_at: row.ai_enriched_at,
  };
}

function mapLogRow(row: ActionLogRow) {
  let metadata: unknown = null;
  if (row.metadata) {
    try {
      metadata = JSON.parse(row.metadata);
    } catch (error) {
      metadata = row.metadata;
    }
  }

  return {
    id: row.id,
    timestamp: row.timestamp,
    action_type: row.action_type,
    status: row.status,
    message: row.message,
    metadata,
  };
}

function buildOpenAPISpec(origin: string) {
  const servers = origin
    ? [
        {
          url: origin,
        },
      ]
    : [];

  return {
    openapi: '3.1.0',
    info: {
      title: 'LinkedIn Scraper Worker API',
      version: '1.0.0',
      description:
        'API for managing LinkedIn job scraping profiles, triggering scrapes, querying stored postings, and inspecting worker logs.',
    },
    servers,
    components: {
      schemas: {
        SearchProfile: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            profile_name: { type: 'string' },
            keywords: { type: 'array', items: { type: 'string' } },
            locations: { type: 'array', items: { type: 'string' } },
            is_active: { type: 'integer', enum: [0, 1] },
            created_at: { type: 'string', format: 'date-time' },
          },
        },
        JobPosting: {
          type: 'object',
          properties: {
            job_urn: { type: 'string' },
            position: { type: 'string', nullable: true },
            company: { type: 'string', nullable: true },
            location: { type: 'string', nullable: true },
            salary: { type: 'string', nullable: true },
            job_url: { type: 'string', nullable: true, format: 'uri' },
            company_logo_url: { type: 'string', nullable: true, format: 'uri' },
            posted_time_text: { type: 'string', nullable: true },
            posted_date: { type: 'string', nullable: true },
            insights: { type: 'string', nullable: true },
            search_keyword: { type: 'string' },
            search_location: { type: 'string' },
            last_scraped_at: { type: 'string', nullable: true, format: 'date-time' },
            ai_category: { type: 'string', nullable: true },
            ai_skills: { type: 'string', nullable: true },
            ai_skills_parsed: { type: 'array', items: { type: 'string' }, nullable: true },
            ai_summary: { type: 'string', nullable: true },
            ai_seniority_level: { type: 'string', nullable: true },
            ai_enriched_at: { type: 'string', nullable: true, format: 'date-time' },
          },
        },
        ActionLog: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            timestamp: { type: 'string', format: 'date-time' },
            action_type: { type: 'string' },
            status: { type: 'string' },
            message: { type: 'string', nullable: true },
            metadata: { type: ['object', 'string', 'null'] },
          },
        },
        ProfileRequest: {
          type: 'object',
          required: ['profile_name', 'keywords', 'locations'],
          properties: {
            profile_name: { type: 'string', example: 'AI Product Roles' },
            keywords: {
              type: 'array',
              items: { type: 'string' },
              example: DEFAULT_ROLES,
            },
            locations: {
              type: 'array',
              items: { type: 'string' },
              example: DEFAULT_LOCATIONS,
            },
          },
        },
        RunAdhocRequest: {
          type: 'object',
          required: ['keywords', 'locations'],
          properties: {
            keywords: {
              type: 'array',
              items: { type: 'string' },
              example: DEFAULT_ROLES,
            },
            locations: {
              type: 'array',
              items: { type: 'string' },
              example: DEFAULT_LOCATIONS,
            },
          },
        },
        RunProfilesRequest: {
          type: 'object',
          required: ['profile_ids'],
          properties: {
            profile_ids: {
              type: 'array',
              items: { type: 'string', format: 'uuid' },
            },
          },
        },
        JobsResponse: {
          type: 'object',
          properties: {
            jobs: {
              type: 'array',
              items: { $ref: '#/components/schemas/JobPosting' },
            },
            total: { type: 'integer' },
          },
        },
        LogsResponse: {
          type: 'object',
          properties: {
            logs: {
              type: 'array',
              items: { $ref: '#/components/schemas/ActionLog' },
            },
          },
        },
        ErrorResponse: {
          type: 'object',
          properties: {
            error: { type: 'string' },
          },
        },
      },
    },
    paths: {
      '/api/profiles': {
        get: {
          operationId: 'listProfiles',
          summary: 'List all search profiles',
          responses: {
            '200': {
              description: 'List of profiles',
              content: {
                'application/json': {
                  schema: {
                    type: 'array',
                    items: { $ref: '#/components/schemas/SearchProfile' },
                  },
                },
              },
            },
          },
        },
        post: {
          operationId: 'createProfile',
          summary: 'Create a new search profile',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ProfileRequest' },
              },
            },
          },
          responses: {
            '201': {
              description: 'Created profile',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/SearchProfile' },
                },
              },
            },
            '400': {
              description: 'Invalid request',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
          },
        },
      },
      '/api/profiles/{id}': {
        put: {
          operationId: 'updateProfile',
          summary: 'Update an existing search profile',
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string', format: 'uuid' },
            },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ProfileRequest' },
              },
            },
          },
          responses: {
            '200': {
              description: 'Updated profile',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/SearchProfile' },
                },
              },
            },
            '404': {
              description: 'Profile not found',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
          },
        },
        delete: {
          operationId: 'deactivateProfile',
          summary: 'Deactivate a profile',
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string', format: 'uuid' },
            },
          ],
          responses: {
            '204': {
              description: 'Profile deactivated',
            },
            '404': {
              description: 'Profile not found',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
          },
        },
      },
      '/api/searches/run-adhoc': {
        post: {
          operationId: 'runAdhocSearch',
          summary: 'Execute ad-hoc scrape',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/RunAdhocRequest' },
              },
            },
          },
          responses: {
            '200': {
              description: 'Scrape results',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      jobs: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/JobPosting' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/api/searches/run-profiles': {
        post: {
          operationId: 'runProfilesSearch',
          summary: 'Run scrapes for stored profiles',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/RunProfilesRequest' },
              },
            },
          },
          responses: {
            '200': {
              description: 'Number of scrapes triggered',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      totalRuns: { type: 'integer' },
                    },
                  },
                },
              },
            },
            '404': {
              description: 'Profile not found',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
          },
        },
      },
      '/api/jobs': {
        get: {
          operationId: 'listJobs',
          summary: 'List stored job postings',
          parameters: [
            { name: 'search', in: 'query', schema: { type: 'string' } },
            { name: 'keyword', in: 'query', schema: { type: 'string' } },
            { name: 'location', in: 'query', schema: { type: 'string' } },
            { name: 'start_date', in: 'query', schema: { type: 'string', format: 'date' } },
            { name: 'end_date', in: 'query', schema: { type: 'string', format: 'date' } },
            { name: 'ai_category', in: 'query', schema: { type: 'string' } },
            { name: 'ai_seniority', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
            { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0 } },
          ],
          responses: {
            '200': {
              description: 'Filtered job postings',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/JobsResponse' },
                },
              },
            },
          },
        },
      },
      '/api/logs': {
        get: {
          operationId: 'listLogs',
          summary: 'List worker action logs',
          parameters: [
            { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 500 } },
            { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0 } },
          ],
          responses: {
            '200': {
              description: 'Recent logs',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/LogsResponse' },
                },
              },
            },
          },
        },
      },
    },
  };
}

const app = new Hono<WorkerEnv>();

app.use('*', cors());

app.onError(async (error, c) => {
  const status = error instanceof HTTPException ? error.status : 500;
  const message = error instanceof HTTPException ? error.message : 'Internal Server Error';

  await logAction(c.env, 'api_error', 'error', message, {
    path: c.req.path,
    method: c.req.method,
    status,
  });

  if (error instanceof HTTPException) {
    return error.getResponse();
  }

  return c.json({ error: message }, status);
});

app.get('/api/profiles', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT id, profile_name, keywords, locations, is_active, created_at FROM search_profiles ORDER BY datetime(created_at) DESC'
  ).all<SearchProfileRow>();

  const profiles = (results ?? []).map(mapProfileRow);
  await logAction(c.env, 'api_get_profiles', 'success', 'Fetched profiles', { count: profiles.length });
  return c.json(profiles);
});

app.post('/api/profiles', async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  const profileName = typeof body.profile_name === 'string' ? body.profile_name.trim() : '';
  const keywords = parseArrayInput(body.keywords);
  const locations = parseArrayInput(body.locations);

  if (!profileName || keywords.length === 0 || locations.length === 0) {
    throw new HTTPException(400, { message: 'profile_name, keywords, and locations are required.' });
  }

  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO search_profiles (id, profile_name, keywords, locations, is_active) VALUES (?, ?, ?, ?, ?)`
  )
    .bind(id, profileName, JSON.stringify(keywords), JSON.stringify(locations), 1)
    .run();

  const inserted = await c.env.DB.prepare(
    'SELECT id, profile_name, keywords, locations, is_active, created_at FROM search_profiles WHERE id = ?'
  )
    .bind(id)
    .first<SearchProfileRow>();

  const profile = inserted
    ? mapProfileRow(inserted)
    : {
        id,
        profile_name: profileName,
        keywords,
        locations,
        is_active: 1,
        created_at: new Date().toISOString(),
      };

  await logAction(c.env, 'api_create_profile', 'success', 'Profile created', { id });
  return c.json(profile, 201);
});

app.put('/api/profiles/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<Record<string, unknown>>();
  const profileName = typeof body.profile_name === 'string' ? body.profile_name.trim() : '';
  const keywords = parseArrayInput(body.keywords);
  const locations = parseArrayInput(body.locations);

  if (!profileName || keywords.length === 0 || locations.length === 0) {
    throw new HTTPException(400, { message: 'profile_name, keywords, and locations are required.' });
  }

  const existing = await c.env.DB.prepare(
    'SELECT id, profile_name, keywords, locations, is_active, created_at FROM search_profiles WHERE id = ?'
  )
    .bind(id)
    .first<SearchProfileRow>();

  if (!existing) {
    throw new HTTPException(404, { message: 'Profile not found.' });
  }

  await c.env.DB.prepare(
    'UPDATE search_profiles SET profile_name = ?, keywords = ?, locations = ? WHERE id = ?'
  )
    .bind(profileName, JSON.stringify(keywords), JSON.stringify(locations), id)
    .run();

  const profile = mapProfileRow({
    ...existing,
    profile_name: profileName,
    keywords: JSON.stringify(keywords),
    locations: JSON.stringify(locations),
  });

  await logAction(c.env, 'api_update_profile', 'success', 'Profile updated', { id });
  return c.json(profile);
});

app.delete('/api/profiles/:id', async (c) => {
  const id = c.req.param('id');
  const result = await c.env.DB.prepare('UPDATE search_profiles SET is_active = 0 WHERE id = ?')
    .bind(id)
    .run();

  if (!result.success || result.changes === 0) {
    throw new HTTPException(404, { message: 'Profile not found.' });
  }

  await logAction(c.env, 'api_delete_profile', 'success', 'Profile deactivated', { id });
  return c.body(null, 204);
});

app.post('/api/searches/run-adhoc', async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  const keywords = parseArrayInput(body.keywords);
  const locations = parseArrayInput(body.locations);

  if (keywords.length === 0 || locations.length === 0) {
    throw new HTTPException(400, { message: 'keywords and locations must be non-empty arrays.' });
  }

  const scrapePromises: Promise<JobPostingRecord[]>[] = [];
  for (const keyword of keywords) {
    for (const location of locations) {
      scrapePromises.push(runScrape(c.env, keyword, location));
    }
  }
  const jobSets = await Promise.all(scrapePromises);
  const results = jobSets.flat();

  await logAction(c.env, 'api_run_adhoc', 'success', 'Ad-hoc scrape completed', {
    keywords,
    locations,
    totalJobs: results.length,
  });

  return c.json({ jobs: results });
});

app.post('/api/searches/run-profiles', async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  const profileIds = parseArrayInput(body.profile_ids);

  if (profileIds.length === 0) {
    throw new HTTPException(400, { message: 'profile_ids must be a non-empty array.' });
  }

  const { results } = await c.env.DB.prepare(
    `SELECT id, profile_name, keywords, locations, is_active, created_at
     FROM search_profiles WHERE id IN (${profileIds.map(() => '?').join(',')}) AND is_active = 1`
  )
    .bind(...profileIds)
    .all<SearchProfileRow>();

  if (!results || results.length === 0) {
    throw new HTTPException(404, { message: 'No active profiles found for the provided IDs.' });
  }

  let totalRuns = 0;
  for (const row of results) {
    const profile = mapProfileRow(row);
    for (const keyword of profile.keywords) {
      for (const location of profile.locations) {
        await runScrape(c.env, keyword, location);
        totalRuns += 1;
      }
    }
  }

  await logAction(c.env, 'api_run_profiles', 'success', 'Profile scrapes completed', {
    profileIds,
    totalRuns,
  });

  return c.json({ totalRuns });
});

app.get('/api/jobs', async (c) => {
  const { search, keyword, location, start_date, end_date, ai_category, ai_seniority } = c.req.query();
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') ?? '25', 10) || 25, 1), 100);
  const offset = Math.max(parseInt(c.req.query('offset') ?? '0', 10) || 0, 0);

  const filters: string[] = [];
  const bindings: unknown[] = [];

  if (search) {
    filters.push('(position LIKE ? OR company LIKE ?)');
    bindings.push(`%${search}%`, `%${search}%`);
  }

  if (keyword) {
    filters.push('search_keyword = ?');
    bindings.push(keyword);
  }

  if (location) {
    filters.push('search_location = ?');
    bindings.push(location);
  }

  if (start_date) {
    filters.push('date(last_scraped_at) >= date(?)');
    bindings.push(start_date);
  }

  if (end_date) {
    filters.push('date(last_scraped_at) <= date(?)');
    bindings.push(end_date);
  }

  if (ai_category) {
    filters.push('ai_category = ?');
    bindings.push(ai_category);
  }

  if (ai_seniority) {
    filters.push('ai_seniority_level = ?');
    bindings.push(ai_seniority);
  }

  const whereClause = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
  const query = `SELECT * FROM job_postings ${whereClause} ORDER BY datetime(last_scraped_at) DESC LIMIT ? OFFSET ?`;
  const countQuery = `SELECT COUNT(*) as count FROM job_postings ${whereClause}`;

  const jobsResult = await c.env.DB.prepare(query)
    .bind(...bindings, limit, offset)
    .all<JobPostingRow>();

  const countResult = await c.env.DB.prepare(countQuery).bind(...bindings).first<{ count: number }>();

  const jobs = (jobsResult.results ?? []).map(mapJobRow);
  const total = countResult?.count ?? 0;

  await logAction(c.env, 'api_get_jobs', 'success', 'Jobs fetched', {
    count: jobs.length,
    total,
  });

  return c.json({ jobs, total });
});

app.get('/api/logs', async (c) => {
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') ?? '100', 10) || 100, 1), 500);
  const offset = Math.max(parseInt(c.req.query('offset') ?? '0', 10) || 0, 0);

  const { results } = await c.env.DB.prepare(
    'SELECT id, timestamp, action_type, status, message, metadata FROM action_logs ORDER BY datetime(timestamp) DESC LIMIT ? OFFSET ?'
  )
    .bind(limit, offset)
    .all<ActionLogRow>();

  const logs = (results ?? []).map(mapLogRow);
  await logAction(c.env, 'api_get_logs', 'success', 'Logs fetched', {
    count: logs.length,
  });

  return c.json({ logs });
});

app.get('/openapi.json', async (c) => {
  const url = new URL(c.req.url);
  const spec = buildOpenAPISpec(`${url.protocol}//${url.host}`);
  await logAction(c.env, 'api_get_openapi', 'success', 'OpenAPI JSON served', {
    format: 'json',
  });
  return c.json(spec);
});

app.get('/openapi.yaml', async (c) => {
  const url = new URL(c.req.url);
  const spec = buildOpenAPISpec(`${url.protocol}//${url.host}`);
  const yaml = stringifyYaml(spec);
  await logAction(c.env, 'api_get_openapi', 'success', 'OpenAPI YAML served', {
    format: 'yaml',
  });
  return c.text(yaml, 200, { 'Content-Type': 'application/yaml; charset=utf-8' });
});

app.get('/ws', async (c) => {
  const upgradeHeader = c.req.header('Upgrade');
  if (!upgradeHeader || upgradeHeader !== 'websocket') {
    return c.text('Expected Upgrade: websocket', 426);
  }

  // Get or create a Durable Object instance
  const id = c.env.JOBS_WEBSOCKET.idFromName('jobs-ws');
  const stub = c.env.JOBS_WEBSOCKET.get(id);

  // Forward the request to the Durable Object
  return stub.fetch(c.req.raw);
});

app.all('*', async (c) => {
  const request = c.req.raw;
  const response = await c.env.ASSETS.fetch(request);
  if (response.status === 404) {
    const indexUrl = new URL('/index.html', c.req.url);
    return c.env.ASSETS.fetch(new Request(indexUrl.toString(), request));
  }

  return response;
});

const worker = {
  fetch: (request: Request, env: Bindings, ctx: unknown) => app.fetch(request, env, ctx),
  scheduled: async (event: { cron: string }, env: Bindings) => {
    await logAction(env, 'cron_run_start', 'info', 'Cron job started', { cron: event.cron });

    try {
      const { results } = await env.DB.prepare(
        'SELECT id, profile_name, keywords, locations, is_active, created_at FROM search_profiles WHERE is_active = 1'
      ).all<SearchProfileRow>();

      const profiles = (results ?? []).map(mapProfileRow);
      let totalRuns = 0;

      for (const profile of profiles) {
        for (const keyword of profile.keywords) {
          for (const location of profile.locations) {
            await runScrape(env, keyword, location);
            totalRuns += 1;
          }
        }
      }

      await logAction(env, 'cron_run_success', 'success', 'Cron job completed', {
        totalProfiles: profiles.length,
        totalRuns,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Cron execution failed';
      await logAction(env, 'cron_run_error', 'error', message, {
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  },
};

export default worker;
