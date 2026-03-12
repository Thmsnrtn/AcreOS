/**
 * openapi-spec.ts
 * Generates the OpenAPI 3.0 specification for the AcreOS API.
 */

export function generateOpenAPISpec(): Record<string, any> {
  return {
    openapi: '3.0.3',
    info: {
      title: 'AcreOS API',
      version: '1.0.0',
      description:
        'AcreOS platform API — land investing CRM, AVM, voice AI, portfolio optimizer, and data licensing.',
      contact: { name: 'AcreOS Support', email: 'support@acreos.com' },
    },
    servers: [
      { url: '/api', description: 'Production API' },
    ],
    components: {
      securitySchemes: {
        sessionCookie: {
          type: 'apiKey',
          in: 'cookie',
          name: 'connect.sid',
          description: 'Session cookie obtained after login via /api/auth/login',
        },
        apiKey: {
          type: 'apiKey',
          in: 'header',
          name: 'X-API-Key',
          description: 'Partner API key for data API endpoints',
        },
      },
      schemas: {
        Lead: {
          type: 'object',
          properties: {
            id: { type: 'integer', example: 1 },
            organizationId: { type: 'integer' },
            firstName: { type: 'string', example: 'John' },
            lastName: { type: 'string', example: 'Smith' },
            email: { type: 'string', format: 'email' },
            phone: { type: 'string', example: '+15125551234' },
            status: { type: 'string', enum: ['new', 'contacted', 'hot', 'warm', 'cold', 'closed', 'dead'] },
            source: { type: 'string', example: 'direct_mail' },
            notes: { type: 'string' },
            tags: { type: 'array', items: { type: 'string' } },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        Property: {
          type: 'object',
          properties: {
            id: { type: 'integer', example: 1 },
            organizationId: { type: 'integer' },
            address: { type: 'string', example: '123 Ranch Rd' },
            city: { type: 'string' },
            state: { type: 'string', example: 'TX' },
            county: { type: 'string' },
            zipCode: { type: 'string' },
            acres: { type: 'number', example: 45.5 },
            apn: { type: 'string', example: '123-456-789' },
            zoning: { type: 'string' },
            purchasePrice: { type: 'number' },
            estimatedValue: { type: 'number' },
            status: { type: 'string', enum: ['lead', 'under_contract', 'owned', 'sold', 'pass'] },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        Deal: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            organizationId: { type: 'integer' },
            propertyId: { type: 'integer' },
            leadId: { type: 'integer' },
            status: { type: 'string', enum: ['draft', 'submitted', 'accepted', 'rejected', 'closed'] },
            offerPrice: { type: 'number' },
            purchasePrice: { type: 'number' },
            closingDate: { type: 'string', format: 'date' },
            notes: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        VoiceCall: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            organizationId: { type: 'integer' },
            phoneNumber: { type: 'string' },
            direction: { type: 'string', enum: ['inbound', 'outbound'] },
            status: { type: 'string', enum: ['initiated', 'active', 'completed', 'failed'] },
            duration: { type: 'integer', description: 'Duration in seconds' },
            sentiment: { type: 'string', enum: ['positive', 'neutral', 'negative'] },
            intent: { type: 'string' },
            outcome: { type: 'string', enum: ['interested', 'not-interested', 'callback', 'voicemail'] },
            summary: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        AVMValuation: {
          type: 'object',
          properties: {
            propertyId: { type: 'integer' },
            estimatedValue: { type: 'number', example: 125000 },
            confidenceScore: { type: 'number', example: 0.87 },
            pricePerAcre: { type: 'number', example: 2750 },
            valuationModel: { type: 'string', example: 'gradient_boost_v2' },
            comparables: { type: 'array', items: { type: 'object' } },
            shapeAdjustments: { type: 'array', items: { type: 'object' } },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        LandCreditScore: {
          type: 'object',
          properties: {
            propertyId: { type: 'string' },
            score: { type: 'integer', minimum: 300, maximum: 850, example: 720 },
            grade: { type: 'string', enum: ['A+', 'A', 'B+', 'B', 'C+', 'C', 'D', 'F'] },
            riskLevel: { type: 'string', enum: ['excellent', 'good', 'fair', 'poor', 'high'] },
            strengths: { type: 'array', items: { type: 'string' } },
            weaknesses: { type: 'array', items: { type: 'string' } },
            recommendations: { type: 'array', items: { type: 'string' } },
          },
        },
        MarketplaceListing: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            propertyId: { type: 'integer' },
            title: { type: 'string' },
            description: { type: 'string' },
            askingPrice: { type: 'number' },
            pricePerAcre: { type: 'number' },
            acres: { type: 'number' },
            status: { type: 'string', enum: ['active', 'pending', 'sold', 'withdrawn'] },
            sellerFinancing: { type: 'boolean' },
            images: { type: 'array', items: { type: 'string', format: 'uri' } },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        PortfolioMetrics: {
          type: 'object',
          properties: {
            totalValue: { type: 'number' },
            totalProperties: { type: 'integer' },
            totalAcres: { type: 'number' },
            totalCashFlow: { type: 'number' },
            avgAppreciation: { type: 'number' },
            sharpeRatio: { type: 'number' },
            diversificationScore: { type: 'number' },
          },
        },
        Error: {
          type: 'object',
          properties: {
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
        Success: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
          },
        },
      },
      responses: {
        Unauthorized: {
          description: 'Authentication required',
          content: { 'application/json': { schema: { '$ref': '#/components/schemas/Error' } } },
        },
        NotFound: {
          description: 'Resource not found',
          content: { 'application/json': { schema: { '$ref': '#/components/schemas/Error' } } },
        },
        InternalError: {
          description: 'Internal server error',
          content: { 'application/json': { schema: { '$ref': '#/components/schemas/Error' } } },
        },
      },
    },
    security: [{ sessionCookie: [] }],
    paths: {
      // ── AUTH ──────────────────────────────────────────────────────────────────
      '/auth/login': {
        post: {
          summary: 'Login',
          operationId: 'login',
          tags: ['Authentication'],
          security: [],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['email', 'password'],
                  properties: {
                    email: { type: 'string', format: 'email', example: 'user@example.com' },
                    password: { type: 'string', example: 'password123' },
                  },
                },
              },
            },
          },
          responses: {
            '200': { description: 'Login successful', content: { 'application/json': { schema: { type: 'object', properties: { user: { type: 'object' } } } } } },
            '401': { '$ref': '#/components/responses/Unauthorized' },
          },
        },
      },
      '/auth/logout': {
        post: {
          summary: 'Logout',
          operationId: 'logout',
          tags: ['Authentication'],
          responses: { '200': { description: 'Logged out' } },
        },
      },
      '/auth/me': {
        get: {
          summary: 'Get current user',
          operationId: 'getMe',
          tags: ['Authentication'],
          responses: {
            '200': { description: 'Current user', content: { 'application/json': { schema: { type: 'object' } } } },
            '401': { '$ref': '#/components/responses/Unauthorized' },
          },
        },
      },

      // ── LEADS ─────────────────────────────────────────────────────────────────
      '/leads': {
        get: {
          summary: 'List leads',
          operationId: 'listLeads',
          tags: ['Leads'],
          parameters: [
            { name: 'status', in: 'query', schema: { type: 'string' } },
            { name: 'search', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
            { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
          ],
          responses: {
            '200': { description: 'List of leads', content: { 'application/json': { schema: { type: 'object', properties: { leads: { type: 'array', items: { '$ref': '#/components/schemas/Lead' } }, total: { type: 'integer' } } } } } },
            '401': { '$ref': '#/components/responses/Unauthorized' },
          },
        },
        post: {
          summary: 'Create lead',
          operationId: 'createLead',
          tags: ['Leads'],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { '$ref': '#/components/schemas/Lead' } } },
          },
          responses: {
            '201': { description: 'Lead created', content: { 'application/json': { schema: { '$ref': '#/components/schemas/Lead' } } } },
            '400': { description: 'Validation error' },
          },
        },
      },
      '/leads/{id}': {
        get: {
          summary: 'Get lead',
          operationId: 'getLead',
          tags: ['Leads'],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
          responses: {
            '200': { description: 'Lead details', content: { 'application/json': { schema: { '$ref': '#/components/schemas/Lead' } } } },
            '404': { '$ref': '#/components/responses/NotFound' },
          },
        },
        patch: {
          summary: 'Update lead',
          operationId: 'updateLead',
          tags: ['Leads'],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
          requestBody: { required: true, content: { 'application/json': { schema: { '$ref': '#/components/schemas/Lead' } } } },
          responses: { '200': { description: 'Updated lead' }, '404': { '$ref': '#/components/responses/NotFound' } },
        },
        delete: {
          summary: 'Delete lead',
          operationId: 'deleteLead',
          tags: ['Leads'],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
          responses: { '200': { description: 'Deleted' }, '404': { '$ref': '#/components/responses/NotFound' } },
        },
      },

      // ── PROPERTIES ────────────────────────────────────────────────────────────
      '/properties': {
        get: {
          summary: 'List properties',
          operationId: 'listProperties',
          tags: ['Properties'],
          parameters: [
            { name: 'status', in: 'query', schema: { type: 'string' } },
            { name: 'state', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
          ],
          responses: { '200': { description: 'Properties list', content: { 'application/json': { schema: { type: 'object', properties: { properties: { type: 'array', items: { '$ref': '#/components/schemas/Property' } } } } } } } },
        },
        post: {
          summary: 'Create property',
          operationId: 'createProperty',
          tags: ['Properties'],
          requestBody: { required: true, content: { 'application/json': { schema: { '$ref': '#/components/schemas/Property' } } } },
          responses: { '201': { description: 'Property created' } },
        },
      },

      // ── DEALS ─────────────────────────────────────────────────────────────────
      '/deals': {
        get: {
          summary: 'List deals',
          operationId: 'listDeals',
          tags: ['Deals'],
          responses: { '200': { description: 'Deals list' } },
        },
        post: {
          summary: 'Create deal',
          operationId: 'createDeal',
          tags: ['Deals'],
          requestBody: { required: true, content: { 'application/json': { schema: { '$ref': '#/components/schemas/Deal' } } } },
          responses: { '201': { description: 'Deal created' } },
        },
      },

      // ── AVM ───────────────────────────────────────────────────────────────────
      '/avm/{propertyId}': {
        get: {
          summary: 'Get AVM valuation for a property',
          operationId: 'getAVMValuation',
          tags: ['AVM'],
          parameters: [{ name: 'propertyId', in: 'path', required: true, schema: { type: 'integer' } }],
          responses: {
            '200': { description: 'AVM valuation', content: { 'application/json': { schema: { '$ref': '#/components/schemas/AVMValuation' } } } },
            '404': { '$ref': '#/components/responses/NotFound' },
          },
        },
      },
      '/avm/{propertyId}/valuate': {
        post: {
          summary: 'Run AVM valuation for a property',
          operationId: 'runAVMValuation',
          tags: ['AVM'],
          parameters: [{ name: 'propertyId', in: 'path', required: true, schema: { type: 'integer' } }],
          responses: { '200': { description: 'Fresh AVM valuation', content: { 'application/json': { schema: { '$ref': '#/components/schemas/AVMValuation' } } } } },
        },
      },
      '/avm/bulk': {
        post: {
          summary: 'Bulk AVM valuation from CSV',
          operationId: 'bulkAVMValuation',
          tags: ['AVM'],
          requestBody: {
            required: true,
            content: { 'multipart/form-data': { schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } } },
          },
          responses: { '200': { description: 'Bulk valuation results', content: { 'application/json': { schema: { type: 'object', properties: { results: { type: 'array', items: { '$ref': '#/components/schemas/AVMValuation' } } } } } } } },
        },
      },

      // ── VOICE ─────────────────────────────────────────────────────────────────
      '/voice/calls': {
        get: {
          summary: 'List voice calls',
          operationId: 'listCalls',
          tags: ['Voice AI'],
          parameters: [
            { name: 'leadId', in: 'query', schema: { type: 'integer' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
          ],
          responses: { '200': { description: 'List of calls', content: { 'application/json': { schema: { type: 'object', properties: { calls: { type: 'array', items: { '$ref': '#/components/schemas/VoiceCall' } } } } } } } },
        },
        post: {
          summary: 'Initiate an outbound call',
          operationId: 'initiateCall',
          tags: ['Voice AI'],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { type: 'object', required: ['phoneNumber'], properties: { phoneNumber: { type: 'string' }, direction: { type: 'string', enum: ['outbound', 'inbound'] }, leadId: { type: 'integer' }, propertyId: { type: 'integer' } } } } },
          },
          responses: { '201': { description: 'Call initiated', content: { 'application/json': { schema: { type: 'object', properties: { callId: { type: 'string' }, success: { type: 'boolean' } } } } } } },
        },
      },
      '/voice/calls/{id}/summary': {
        get: {
          summary: 'Get post-call AI summary',
          operationId: 'getCallSummary',
          tags: ['Voice AI'],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
          responses: { '200': { description: 'Call summary with action items and sentiment' } },
        },
      },
      '/voice/calls/{id}/outcome': {
        post: {
          summary: 'Tag call outcome',
          operationId: 'tagCallOutcome',
          tags: ['Voice AI'],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { type: 'object', required: ['type'], properties: { type: { type: 'string', enum: ['interested', 'not-interested', 'callback', 'voicemail'] }, notes: { type: 'string' } } } } },
          },
          responses: { '200': { description: 'Outcome tagged' } },
        },
      },
      '/voice/calls/{id}/speakers': {
        get: {
          summary: 'Get speaker diarization info',
          operationId: 'getCallSpeakers',
          tags: ['Voice AI'],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
          responses: { '200': { description: 'Speaker stats' } },
        },
      },
      '/voice/transcripts/search': {
        get: {
          summary: 'Search call transcripts',
          operationId: 'searchTranscripts',
          tags: ['Voice AI'],
          parameters: [
            { name: 'q', in: 'query', required: true, schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
          ],
          responses: { '200': { description: 'Search results with context snippets' } },
        },
      },
      '/voice/analytics': {
        get: {
          summary: 'Get call analytics summary',
          operationId: 'getCallAnalytics',
          tags: ['Voice AI'],
          responses: { '200': { description: 'Analytics data' } },
        },
      },

      // ── MARKETPLACE ───────────────────────────────────────────────────────────
      '/marketplace/listings': {
        get: {
          summary: 'List marketplace listings',
          operationId: 'listListings',
          tags: ['Marketplace'],
          parameters: [
            { name: 'state', in: 'query', schema: { type: 'string' } },
            { name: 'minAcres', in: 'query', schema: { type: 'number' } },
            { name: 'maxPrice', in: 'query', schema: { type: 'number' } },
            { name: 'sellerFinancing', in: 'query', schema: { type: 'boolean' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
          ],
          responses: { '200': { description: 'Marketplace listings', content: { 'application/json': { schema: { type: 'object', properties: { listings: { type: 'array', items: { '$ref': '#/components/schemas/MarketplaceListing' } } } } } } } },
        },
      },

      // ── PORTFOLIO OPTIMIZER ───────────────────────────────────────────────────
      '/portfolio-optimizer/metrics': {
        get: {
          summary: 'Get portfolio metrics',
          operationId: 'getPortfolioMetrics',
          tags: ['Portfolio'],
          responses: { '200': { description: 'Portfolio metrics', content: { 'application/json': { schema: { '$ref': '#/components/schemas/PortfolioMetrics' } } } } },
        },
      },
      '/portfolio-optimizer/analyze': {
        post: {
          summary: 'Run full portfolio analysis',
          operationId: 'analyzePortfolio',
          tags: ['Portfolio'],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { yearsForward: { type: 'integer', default: 5 } } } } } },
          responses: { '200': { description: 'Analysis complete' } },
        },
      },
      '/portfolio-optimizer/simulate': {
        post: {
          summary: 'Run Monte Carlo simulation',
          operationId: 'runSimulation',
          tags: ['Portfolio'],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { yearsForward: { type: 'integer' }, numSimulations: { type: 'integer', default: 10000 } } } } } },
          responses: { '200': { description: 'Simulation results' } },
        },
      },

      // ── LAND CREDIT ───────────────────────────────────────────────────────────
      '/land-credit/score/{propertyId}': {
        post: {
          summary: 'Calculate land credit score',
          operationId: 'calculateLandCredit',
          tags: ['Land Credit'],
          parameters: [{ name: 'propertyId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Credit score', content: { 'application/json': { schema: { '$ref': '#/components/schemas/LandCreditScore' } } } } },
        },
      },
      '/land-credit/property/{propertyId}': {
        get: {
          summary: 'Get credit score history for a property',
          operationId: 'getLandCreditHistory',
          tags: ['Land Credit'],
          parameters: [{ name: 'propertyId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Score history' } },
        },
      },
      '/land-credit/bulk': {
        post: {
          summary: 'Bulk score all properties',
          operationId: 'bulkLandCredit',
          tags: ['Land Credit'],
          responses: { '200': { description: 'Bulk scoring results', content: { 'application/json': { schema: { type: 'object', properties: { scored: { type: 'integer' }, failed: { type: 'integer' } } } } } } },
        },
      },

      // ── DATA API ──────────────────────────────────────────────────────────────
      '/data-api/benchmarks/{state}/{propertyType}': {
        get: {
          summary: 'Get anonymized benchmark data',
          operationId: 'getBenchmarks',
          tags: ['Data API'],
          security: [{ apiKey: [] }, { sessionCookie: [] }],
          parameters: [
            { name: 'state', in: 'path', required: true, schema: { type: 'string', example: 'TX' } },
            { name: 'propertyType', in: 'path', required: true, schema: { type: 'string', example: 'agricultural' } },
            { name: 'months', in: 'query', schema: { type: 'integer', default: 12 } },
          ],
          responses: { '200': { description: 'Benchmark data' }, '401': { '$ref': '#/components/responses/Unauthorized' } },
        },
      },
      '/data-api/price-trends/{county}': {
        get: {
          summary: 'Get price trend data for a county',
          operationId: 'getPriceTrends',
          tags: ['Data API'],
          security: [{ apiKey: [] }, { sessionCookie: [] }],
          parameters: [
            { name: 'county', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'state', in: 'query', schema: { type: 'string' } },
          ],
          responses: { '200': { description: 'Price trend data' } },
        },
      },
      '/data-api/demand/{state}': {
        get: {
          summary: 'Get buyer demand indicators for a state',
          operationId: 'getDemand',
          tags: ['Data API'],
          security: [{ apiKey: [] }, { sessionCookie: [] }],
          parameters: [{ name: 'state', in: 'path', required: true, schema: { type: 'string', example: 'TX' } }],
          responses: { '200': { description: 'Demand data by county' } },
        },
      },
      '/data-api/keys': {
        post: {
          summary: 'Issue a new partner API key',
          operationId: 'issueApiKey',
          tags: ['Data API'],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, provider: { type: 'string' } } } } } },
          responses: { '200': { description: 'New API key created' }, '403': { description: 'Admin required' } },
        },
        get: {
          summary: 'List partner API keys',
          operationId: 'listApiKeys',
          tags: ['Data API'],
          responses: { '200': { description: 'API keys list' } },
        },
      },
      '/data-api/keys/{id}': {
        delete: {
          summary: 'Revoke API key',
          operationId: 'revokeApiKey',
          tags: ['Data API'],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
          responses: { '200': { description: 'Key revoked' } },
        },
      },
      '/data-api/usage/{keyId}': {
        get: {
          summary: 'Get API key usage stats',
          operationId: 'getApiKeyUsage',
          tags: ['Data API'],
          parameters: [{ name: 'keyId', in: 'path', required: true, schema: { type: 'integer' } }],
          responses: { '200': { description: 'Usage statistics' } },
        },
      },
    },
    tags: [
      { name: 'Authentication', description: 'Login, logout, session management' },
      { name: 'Leads', description: 'Seller lead CRM operations' },
      { name: 'Properties', description: 'Property tracking and due diligence' },
      { name: 'Deals', description: 'Offer and deal pipeline management' },
      { name: 'AVM', description: 'Automated Valuation Model — AI-powered property valuations' },
      { name: 'Voice AI', description: 'Twilio-powered voice calls with AI transcription and analysis' },
      { name: 'Marketplace', description: 'Land marketplace listings for buyers and sellers' },
      { name: 'Portfolio', description: 'Portfolio optimization, Monte Carlo simulation, and AI recommendations' },
      { name: 'Land Credit', description: 'Proprietary 300-850 land credit scoring (FICO for land)' },
      { name: 'Data API', description: 'Licensed data access for partners — requires API key' },
    ],
  };
}
