# Usage Guide

## Default Behavior

By default, running `node index.js` will:

1. **Search 3 default roles**: "Data Engineer", "AI PM", "Legal Program Manager"
2. **Search 2 locations per role**: "San Francisco Bay Area" and "Remote"
3. **Total**: 6 searches (3 roles × 2 locations)
4. **Output**: JSON files saved to `data/` directory

## Quick Start

```bash
# Install dependencies (if not already installed)
npm install

# Run all default roles (6 searches total)
node index.js

# Or use npm script
npm start
```

## Output Files

Results are saved to the `data/` directory with naming convention:
- `Data Engineer_SFBA_Remote.json`
- `AI PM_SFBA_Remote.json`
- `Legal Program Manager_SFBA_Remote.json`

Each file contains jobs from **both** San Francisco Bay Area and Remote locations combined.

## Command Line Options

```bash
# Limit number of jobs per search
node index.js --limit 50

# Set maximum pages to scrape (25 jobs per page)
node index.js --pages 5

# Save raw API payloads to data/payload/ directory (default: false)
node index.js --save-payloads
```

## Programmatic Usage

```javascript
const linkedIn = require('./index.js');

// Run all default roles
linkedIn.runAllDefaultRoles({
  limit: 100,
  maxPages: 3,
  jobType: 'full time',
  experienceLevel: 'entry level',
  savePayloads: false // Set to true to save raw API responses
}).then(results => {
  console.log('All done!', results);
});

// Or query individual jobs
linkedIn.query({
  keyword: 'Data Engineer',
  location: 'San Francisco Bay Area',
  jobType: 'full time',
  experienceLevel: 'entry level',
  limit: 25,
  savePayloads: false // Set to true to save raw API responses
}).then(jobs => {
  console.log(`Found ${jobs.length} jobs`);
});
```

## Configuration

Default roles and locations are defined in `index.js`:

```javascript
const DEFAULT_ROLES = ["Data Engineer", "AI PM", "Legal Program Manager"];
const DEFAULT_LOCATIONS = ["San Francisco Bay Area", "Remote"];
```

To modify, edit these constants in `index.js`.

## Output Format

Each JSON file contains an array of job objects:

```json
[
  {
    "title": "Job Title",
    "company": "Company Name",
    "location": "Job Location",
    "link": "/jobs/view/...",
    "posted_time": "2 days ago",
    "salary": "Not specified",
    "companyLogo": "https://..."
  }
]
```

