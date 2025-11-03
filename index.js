const cheerio = require("cheerio");
const axios = require("axios");
const randomUseragent = require("random-useragent");
const fs = require("fs");
const path = require("path");

// Utility functions
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Default roles to search (always the same)
const DEFAULT_ROLES = ["Data Engineer", "AI PM", "Legal Program Manager"];

// Hardcoded locations as per Python scraper
const DEFAULT_LOCATIONS = ["San Francisco Bay Area", "Remote"];

// Cache implementation
class JobCache {
  constructor() {
    this.cache = new Map();
    this.TTL = 1000 * 60 * 60; // 1 hour
  }

  set(key, value) {
    this.cache.set(key, {
      data: value,
      timestamp: Date.now(),
    });
  }

  get(key) {
    const item = this.cache.get(key);
    if (!item) return null;
    if (Date.now() - item.timestamp > this.TTL) {
      this.cache.delete(key);
      return null;
    }
    return item.data;
  }

  clear() {
    const now = Date.now();
    for (const [key, value] of this.cache.entries()) {
      if (now - value.timestamp > this.TTL) {
        this.cache.delete(key);
      }
    }
  }
}

const cache = new JobCache();

// Query constructor
function Query(queryObj) {
  this.host = queryObj.host || "www.linkedin.com";
  this.keyword = queryObj.keyword?.trim().replace(/\s+/g, "+") || "";
  this.location = queryObj.location?.trim().replace(/\s+/g, "+") || "";
  this.dateSincePosted = queryObj.dateSincePosted || "";
  this.jobType = queryObj.jobType || "";
  this.remoteFilter = queryObj.remoteFilter || "";
  this.salary = queryObj.salary || "";
  this.experienceLevel = queryObj.experienceLevel || "";
  this.sortBy = queryObj.sortBy || "";
  this.limit = Number(queryObj.limit) || 0;
  this.page = Number(queryObj.page) || 0;
  this.has_verification = queryObj.has_verification || false;
  this.under_10_applicants = queryObj.under_10_applicants || false;
  this.savePayloads = queryObj.savePayloads || false; // Default: don't save payloads
}

// Query prototype methods
Query.prototype.getDateSincePosted = function () {
  const dateRange = {
    "past month": "r2592000",
    "past week": "r604800",
    "24hr": "r86400",
  };
  return dateRange[this.dateSincePosted.toLowerCase()] || "";
};

Query.prototype.getExperienceLevel = function () {
  const experienceRange = {
    internship: "1",
    "entry level": "2",
    associate: "3",
    senior: "4",
    director: "5",
    executive: "6",
  };
  return experienceRange[this.experienceLevel.toLowerCase()] || "";
};

Query.prototype.getJobType = function () {
  const jobTypeRange = {
    "full time": "F",
    "full-time": "F",
    "part time": "P",
    "part-time": "P",
    contract: "C",
    temporary: "T",
    volunteer: "V",
    internship: "I",
  };
  return jobTypeRange[this.jobType.toLowerCase()] || "";
};

Query.prototype.getRemoteFilter = function () {
  const remoteFilterRange = {
    "on-site": "1",
    "on site": "1",
    remote: "2",
    hybrid: "3",
  };
  return remoteFilterRange[this.remoteFilter.toLowerCase()] || "";
};

Query.prototype.getSalary = function () {
  const salaryRange = {
    40000: "1",
    60000: "2",
    80000: "3",
    100000: "4",
    120000: "5",
  };
  return salaryRange[this.salary] || "";
};

Query.prototype.getHasVerification = function () {
  return this.has_verification ? "true" : "false";
};

Query.prototype.getUnder10Applicants = function () {
  return this.under_10_applicants ? "true" : "false";
};

Query.prototype.getPage = function () {
  return this.page * 25;
};

// Generate a unique cache key based on the query parameters
Query.prototype.getCacheKey = function () {
  return `${this.url(0)}_limit:${this.limit}`;
};

Query.prototype.url = function (start) {
  let query = `https://${this.host}/jobs-guest/jobs/api/seeMoreJobPostings/search?`;

  const params = new URLSearchParams();

  if (this.keyword) params.append("keywords", this.keyword);
  if (this.location) params.append("location", this.location);
  if (this.getDateSincePosted())
    params.append("f_TPR", this.getDateSincePosted());
  if (this.getSalary()) params.append("f_SB2", this.getSalary());
  if (this.getExperienceLevel())
    params.append("f_E", this.getExperienceLevel());
  if (this.getRemoteFilter()) params.append("f_WT", this.getRemoteFilter());
  if (this.getJobType()) params.append("f_JT", this.getJobType());
  if (this.getHasVerification())
    params.append("f_VJ", this.getHasVerification());
  if (this.getUnder10Applicants())
    params.append("f_EA", this.getUnder10Applicants());

  params.append("start", start + this.getPage());

  if (this.sortBy === "recent") params.append("sortBy", "DD");
  else if (this.sortBy === "relevant") params.append("sortBy", "R");

  return query + params.toString();
};

// Main query function
module.exports.query = (queryObject) => {
  const query = new Query(queryObject);
  return query.getJobs();
};

Query.prototype.getJobs = async function () {
  let allJobs = [];
  let start = 0;
  const BATCH_SIZE = 25;
  let hasMore = true;
  let consecutiveErrors = 0;
  const MAX_CONSECUTIVE_ERRORS = 3;
  console.log(this.url());
  console.log(this.getCacheKey());
  try {
    // Check cache first
    const cacheKey = this.getCacheKey();
    const cachedJobs = cache.get(cacheKey);
    if (cachedJobs) {
      console.log("Returning cached results");
      return cachedJobs;
    }

    while (hasMore) {
      try {
        const jobs = await this.fetchJobBatch(start);

        if (!jobs || jobs.length === 0) {
          hasMore = false;
          break;
        }

        allJobs.push(...jobs);
        console.log(`Fetched ${jobs.length} jobs. Total: ${allJobs.length}`);

        if (this.limit && allJobs.length >= this.limit) {
          allJobs = allJobs.slice(0, this.limit);
          break;
        }

        // Reset error counter on successful fetch
        consecutiveErrors = 0;
        start += BATCH_SIZE;

        // Add reasonable delay between requests
        await delay(2000 + Math.random() * 1000);
      } catch (error) {
        consecutiveErrors++;
        console.error(
          `Error fetching batch (attempt ${consecutiveErrors}):`,
          error.message
        );

        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          console.log("Max consecutive errors reached. Stopping.");
          break;
        }

        // Exponential backoff
        await delay(Math.pow(2, consecutiveErrors) * 1000);
      }
    }

    // Cache results if we got any
    if (allJobs.length > 0) {
      cache.set(this.getCacheKey(), allJobs);
    }

    return allJobs;
  } catch (error) {
    console.error("Fatal error in job fetching:", error);
    throw error;
  }
};

Query.prototype.fetchJobBatch = async function (start) {
  const headers = {
    "User-Agent": randomUseragent.getRandom(),
    Accept: "application/json, text/javascript, */*; q=0.01",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    Referer: "https://www.linkedin.com/jobs",
    "X-Requested-With": "XMLHttpRequest",
    Connection: "keep-alive",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
  };

  try {
    const response = await axios.get(this.url(start), {
      headers,
      validateStatus: function (status) {
        return status === 200;
      },
      timeout: 10000,
    });

    // Save the raw payload before parsing (only if savePayloads is enabled)
    if (this.savePayloads) {
      const batchNumber = Math.floor(start / 25) + 1;
      const payloadString = typeof response.data === 'string' 
        ? response.data 
        : JSON.stringify(response.data, null, 2);
      
      savePayload(
        payloadString,
        this.keyword,
        this.location,
        start,
        batchNumber
      );
    }

    return parseJobList(response.data);
  } catch (error) {
    if (error.response?.status === 429) {
      throw new Error("Rate limit reached");
    }
    throw error;
  }
};

function parseJobList(jobData) {
  try {
    const $ = cheerio.load(jobData);
    const jobs = $("li");

    return jobs
      .map((index, element) => {
        try {
          const job = $(element);
          const position = job.find(".base-search-card__title").text().trim();
          const company = job.find(".base-search-card__subtitle").text().trim();
          const location = job.find(".job-search-card__location").text().trim();
          const dateElement = job.find("time");
          const date = dateElement.attr("datetime");
          const salary = job
            .find(".job-search-card__salary-info")
            .text()
            .trim()
            .replace(/\s+/g, " ");
          // Extract job URL from the full-link anchor
          const jobUrl = job.find(".base-card__full-link").attr("href");
          
          // Ensure full URL if it's a relative path
          const fullJobUrl = jobUrl 
            ? (jobUrl.startsWith('http') ? jobUrl : `https://www.linkedin.com${jobUrl}`)
            : "";
          const companyLogo = job
            .find(".artdeco-entity-image")
            .attr("data-delayed-url");
          const agoTime = job.find(".job-search-card__listdate").text().trim();

          // Only return job if we have at least position and company
          if (!position || !company) {
            return null;
          }

          return {
            position,
            company,
            location,
            date,
            salary: salary || "Not specified",
            jobUrl: fullJobUrl,
            companyLogo: companyLogo || "",
            agoTime: agoTime || "",
          };
        } catch (err) {
          console.warn(`Error parsing job at index ${index}:`, err.message);
          return null;
        }
      })
      .get()
      .filter(Boolean);
  } catch (error) {
    console.error("Error parsing job list:", error);
    return [];
  }
}

// Export additional utilities for testing and monitoring
module.exports.JobCache = JobCache;
module.exports.clearCache = () => cache.clear();
module.exports.getCacheSize = () => cache.cache.size;

// Helper function to sanitize filename
function sanitizeFilename(str) {
  return str
    .replace(/[^a-z0-9\s\-_]/gi, "")
    .trim()
    .replace(/\s+/g, " ");
}

// Helper function to save API payload
function savePayload(payload, keyword, location, start, batchNumber) {
  try {
    const payloadDir = path.join(__dirname, "data", "payload");
    if (!fs.existsSync(payloadDir)) {
      fs.mkdirSync(payloadDir, { recursive: true });
    }

    const safeKeyword = sanitizeFilename(keyword || "unknown");
    const safeLocation = sanitizeFilename(location || "unknown");
    const timestamp = Date.now();
    const batch = batchNumber || Math.floor(start / 25) + 1;
    
    const filename = `${safeKeyword}_${safeLocation}_batch${batch}_${timestamp}.json`;
    const filepath = path.join(payloadDir, filename);

    fs.writeFileSync(filepath, payload, "utf8");
    console.log(`  Saved payload to: ${filepath}`);
    return filepath;
  } catch (error) {
    console.error(`Error saving payload: ${error.message}`);
    return null;
  }
}

// Helper function to get output path
function getOutputPath(query, locations) {
  const dataDir = path.join(__dirname, "data");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const safeQuery = sanitizeFilename(query);
  const safeLocation =
    Array.isArray(locations) && locations.length > 1
      ? "SFBA_Remote"
      : sanitizeFilename(Array.isArray(locations) ? locations[0] : locations);

  return path.join(dataDir, `${safeQuery}_${safeLocation}.json`);
}

// Main runner function that runs all default roles
async function runAllDefaultRoles(options = {}) {
  const {
    limit = 0,
    jobType = "full time",
    experienceLevel = "entry level",
    remoteFilter = "",
    maxPages = 3,
    savePayloads = false, // Default: don't save payloads
  } = options;

  console.log(
    `Running all ${DEFAULT_ROLES.length} default roles...`
  );
  console.log(
    `Each role will search in '${DEFAULT_LOCATIONS[0]}' and '${DEFAULT_LOCATIONS[1]}'`
  );
  console.log(
    `Total: ${DEFAULT_ROLES.length} roles × ${DEFAULT_LOCATIONS.length} locations = ${DEFAULT_ROLES.length * DEFAULT_LOCATIONS.length} searches\n`
  );

  const results = {};

  for (const role of DEFAULT_ROLES) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`Processing role: ${role}`);
    console.log(`${"=".repeat(60)}`);

    const allJobs = [];

    // Search each location for this role
    for (const location of DEFAULT_LOCATIONS) {
      console.log(`\n--- Searching for '${role}' in '${location}' ---`);

      try {
        // Set remote filter based on location
        let effectiveRemoteFilter = remoteFilter;
        if (!effectiveRemoteFilter) {
          if (location === "Remote") {
            effectiveRemoteFilter = "remote";
          } else {
            effectiveRemoteFilter = "";
          }
        }

        const queryOptions = {
          keyword: role,
          location: location,
          jobType: jobType,
          experienceLevel: experienceLevel,
          remoteFilter: effectiveRemoteFilter,
          limit: limit,
          page: 0,
          savePayloads: savePayloads, // Pass through the savePayloads option
        };

        // Calculate max jobs based on pages (25 jobs per page)
        const effectiveLimit = limit || maxPages * 25;

        const jobs = await module.exports.query({
          ...queryOptions,
          limit: effectiveLimit,
        });

        console.log(`Found ${jobs.length} jobs for ${role} in ${location}`);
        allJobs.push(...jobs);
      } catch (error) {
        console.error(
          `Error searching ${role} in ${location}:`,
          error.message
        );
      }
    }

    // Save combined results to JSON file
    if (allJobs.length > 0) {
      const outputPath = getOutputPath(role, DEFAULT_LOCATIONS);
      
      // Transform to match Python scraper format for consistency
      const transformedJobs = allJobs.map((job) => ({
        title: job.position || "",
        company: job.company || "",
        location: job.location || "",
        link: job.jobUrl || "",
        posted_time: job.agoTime || job.date || "",
        salary: job.salary || "",
        companyLogo: job.companyLogo || "",
      }));

      fs.writeFileSync(
        outputPath,
        JSON.stringify(transformedJobs, null, 2),
        "utf8"
      );

      console.log(
        `✓ Saved ${allJobs.length} jobs to ${outputPath}`
      );
      results[role] = {
        total: allJobs.length,
        file: outputPath,
        jobs: transformedJobs,
      };
    } else {
      console.log(`⚠ No jobs found for ${role}`);
      results[role] = {
        total: 0,
        file: null,
        jobs: [],
      };
    }
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`Completed all ${DEFAULT_ROLES.length} roles!`);
  console.log(`${"=".repeat(60)}`);

  return results;
}

// Run as main script if called directly
if (require.main === module) {
  // Parse command line arguments (optional)
  const args = process.argv.slice(2);
  const options = {
    limit: 0, // 0 means no limit
    maxPages: 3,
    jobType: "full time",
    experienceLevel: "entry level",
  };

  // Simple argument parsing
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--limit" && args[i + 1]) {
      options.limit = parseInt(args[i + 1], 10);
    } else if (args[i] === "--pages" && args[i + 1]) {
      options.maxPages = parseInt(args[i + 1], 10);
    } else if (args[i] === "--save-payloads" || args[i] === "--savePayloads") {
      options.savePayloads = true;
    }
  }

  runAllDefaultRoles(options)
    .then((results) => {
      console.log("\nSummary:");
      Object.entries(results).forEach(([role, data]) => {
        console.log(`  ${role}: ${data.total} jobs`);
      });
      process.exit(0);
    })
    .catch((error) => {
      console.error("Fatal error:", error);
      process.exit(1);
    });
}

// Export the main runner function
module.exports.runAllDefaultRoles = runAllDefaultRoles;
module.exports.DEFAULT_ROLES = DEFAULT_ROLES;
module.exports.DEFAULT_LOCATIONS = DEFAULT_LOCATIONS;
