interface Env {
  DB: D1Database;
  AI: Ai;
}

interface WebSocketMessage {
  type: 'list_jobs' | 'search_jobs' | 'trigger_scrape' | 'subscribe' | 'ping';
  payload?: unknown;
}

interface WebSocketResponse {
  type: 'jobs' | 'scrape_result' | 'error' | 'pong' | 'notification';
  payload: unknown;
}

export class JobsWebSocket implements DurableObject {
  private state: DurableObjectState;
  private env: Env;
  private sessions: Set<WebSocket>;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    this.sessions = new Set();
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Handle WebSocket upgrade
    if (request.headers.get('Upgrade') === 'websocket') {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);

      await this.handleSession(server);

      return new Response(null, {
        status: 101,
        webSocket: client,
      });
    }

    // Handle HTTP requests for WebSocket info
    if (url.pathname === '/info') {
      return new Response(
        JSON.stringify({
          connections: this.sessions.size,
          uptime: Date.now(),
        }),
        {
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    return new Response('Expected WebSocket connection', { status: 400 });
  }

  async handleSession(webSocket: WebSocket): Promise<void> {
    webSocket.accept();
    this.sessions.add(webSocket);

    webSocket.addEventListener('message', async (event) => {
      try {
        const data = JSON.parse(event.data as string) as WebSocketMessage;
        await this.handleMessage(webSocket, data);
      } catch (error) {
        const errorMsg: WebSocketResponse = {
          type: 'error',
          payload: {
            message: error instanceof Error ? error.message : 'Invalid message format',
          },
        };
        webSocket.send(JSON.stringify(errorMsg));
      }
    });

    webSocket.addEventListener('close', () => {
      this.sessions.delete(webSocket);
    });

    webSocket.addEventListener('error', () => {
      this.sessions.delete(webSocket);
    });

    // Send welcome message
    const welcome: WebSocketResponse = {
      type: 'notification',
      payload: { message: 'Connected to Jobs WebSocket API' },
    };
    webSocket.send(JSON.stringify(welcome));
  }

  async handleMessage(webSocket: WebSocket, message: WebSocketMessage): Promise<void> {
    switch (message.type) {
      case 'ping':
        webSocket.send(JSON.stringify({ type: 'pong', payload: {} }));
        break;

      case 'list_jobs':
        await this.handleListJobs(webSocket, message.payload);
        break;

      case 'search_jobs':
        await this.handleSearchJobs(webSocket, message.payload);
        break;

      case 'trigger_scrape':
        await this.handleTriggerScrape(webSocket, message.payload);
        break;

      default:
        webSocket.send(
          JSON.stringify({
            type: 'error',
            payload: { message: 'Unknown message type' },
          })
        );
    }
  }

  async handleListJobs(webSocket: WebSocket, payload: unknown): Promise<void> {
    try {
      const params = (payload as Record<string, unknown>) || {};
      const limit = Math.min(Math.max(Number(params.limit) || 25, 1), 100);
      const offset = Math.max(Number(params.offset) || 0, 0);

      const filters: string[] = [];
      const bindings: unknown[] = [];

      if (params.search && typeof params.search === 'string') {
        filters.push('(position LIKE ? OR company LIKE ?)');
        bindings.push(`%${params.search}%`, `%${params.search}%`);
      }

      if (params.keyword && typeof params.keyword === 'string') {
        filters.push('search_keyword = ?');
        bindings.push(params.keyword);
      }

      if (params.location && typeof params.location === 'string') {
        filters.push('search_location = ?');
        bindings.push(params.location);
      }

      if (params.ai_category && typeof params.ai_category === 'string') {
        filters.push('ai_category = ?');
        bindings.push(params.ai_category);
      }

      if (params.ai_seniority && typeof params.ai_seniority === 'string') {
        filters.push('ai_seniority_level = ?');
        bindings.push(params.ai_seniority);
      }

      const whereClause = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
      const query = `SELECT * FROM job_postings ${whereClause} ORDER BY datetime(last_scraped_at) DESC LIMIT ? OFFSET ?`;

      const { results } = await this.env.DB.prepare(query)
        .bind(...bindings, limit, offset)
        .all();

      const jobs = (results || []).map((row) => {
        const job = row as Record<string, unknown>;
        let aiSkillsParsed: string[] = [];
        if (job.ai_skills && typeof job.ai_skills === 'string') {
          try {
            aiSkillsParsed = JSON.parse(job.ai_skills);
          } catch {
            aiSkillsParsed = [];
          }
        }
        return { ...job, ai_skills_parsed: aiSkillsParsed };
      });

      const response: WebSocketResponse = {
        type: 'jobs',
        payload: { jobs, count: jobs.length },
      };

      webSocket.send(JSON.stringify(response));
    } catch (error) {
      webSocket.send(
        JSON.stringify({
          type: 'error',
          payload: { message: error instanceof Error ? error.message : 'Failed to fetch jobs' },
        })
      );
    }
  }

  async handleSearchJobs(webSocket: WebSocket, payload: unknown): Promise<void> {
    // Similar to handleListJobs but with more flexible search
    await this.handleListJobs(webSocket, payload);
  }

  async handleTriggerScrape(webSocket: WebSocket, payload: unknown): Promise<void> {
    try {
      const params = (payload as Record<string, unknown>) || {};

      if (!params.keywords || !Array.isArray(params.keywords) || params.keywords.length === 0) {
        throw new Error('keywords array is required');
      }

      if (!params.locations || !Array.isArray(params.locations) || params.locations.length === 0) {
        throw new Error('locations array is required');
      }

      // Send acknowledgment
      webSocket.send(
        JSON.stringify({
          type: 'notification',
          payload: {
            message: 'Scrape job queued',
            keywords: params.keywords,
            locations: params.locations,
          },
        })
      );

      // Note: The actual scraping would be triggered via the HTTP API
      // This WebSocket endpoint just acknowledges the request
      // In a production setup, you might use a queue or trigger the scrape directly

      const response: WebSocketResponse = {
        type: 'scrape_result',
        payload: {
          status: 'queued',
          message: 'Use the HTTP API /api/searches/run-adhoc to trigger the scrape',
        },
      };

      webSocket.send(JSON.stringify(response));
    } catch (error) {
      webSocket.send(
        JSON.stringify({
          type: 'error',
          payload: { message: error instanceof Error ? error.message : 'Failed to trigger scrape' },
        })
      );
    }
  }

  async broadcast(message: WebSocketResponse): Promise<void> {
    const messageStr = JSON.stringify(message);
    this.sessions.forEach((session) => {
      try {
        session.send(messageStr);
      } catch (error) {
        console.error('Failed to send message to session:', error);
      }
    });
  }
}
