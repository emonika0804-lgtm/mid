import path from 'path';
import fs from 'fs';
import YAML from 'yaml';

export const openapiSpecification: Record<string, any> = {
  openapi: '3.0.3',
  info: {
    title: 'PIL Cargo Claim & Survey Management System API',
    version: '1.0.0',
    description: `
## Overview
Comprehensive REST API for the **Pacific International Lines (PIL) Cargo Claim & Survey Management Platform**.

The platform provides end-to-end management of marine cargo claims, independent condition surveys, document ingestion into PostgreSQL BYTEA binary storage, real-time financial tracking, multi-tier role-based access control (RBAC), and automated exchange rate conversions.

### Key Capabilities:
- **Authentication & RBAC:** Multi-role access control (\`agency\`, \`mid\`, \`mid_gcc\`, \`admin\`) with Row-Level Security (RLS) isolation.
- **Cargo Claim Management:** Complete lifecycle tracking (\`new_claim\`, \`pre_claim\`, \`in_progress\`, \`awaiting_input\`, \`awaiting_approval\`, \`closed\`), automatic sequential numbering (\`CLM-YYYY-XXXX\`), and 1-year time-bar enforcement.
- **Survey Management:** Independent surveyor appointment, condition recording, and atomic conversion into claims.
- **Document Management:** Pure in-database binary storage (\`BYTEA\`), cryptographic SHA-256 integrity verification, magic-byte MIME validation, and authenticated inline preview/download.
- **Financial Module & Integrations:** Multi-currency expense & recovery tallies with real-time Frankfurter API live currency conversion, DB-backed fallback caching, and LMS Bill of Lading lookup.
- **System Health:** Dedicated unauthenticated probes for container/process liveness and PostgreSQL pool readiness.

### Authentication Scheme:
All protected endpoints require a valid JSON Web Token (JWT) transmitted via the standard HTTP \`Authorization\` header:
\`\`\`http
Authorization: Bearer <your_jwt_token>
\`\`\`
`,
    contact: {
      name: 'PIL IT Claims & Marine Insurance Operations',
      email: 'claims-notifications@pilship.com',
      url: 'https://www.pilship.com',
    },
    license: {
      name: 'Proprietary - Pacific International Lines (Pte) Ltd',
    },
  },
  servers: [
    {
      url: 'http://localhost:5000',
      description: 'Local Production & Development Server',
    },
  ],
  tags: [
    {
      name: 'Authentication & Security',
      description: 'User registration, login, cryptographic OTP verification, password reset, and session profile management.',
    },
    {
      name: 'Cargo Claims',
      description: 'End-to-end claim registration, status workflow transitions, row-level security isolation, and field-level audit trails.',
    },
    {
      name: 'Surveys',
      description: 'Independent cargo survey creation, tracking, status updates, and atomic survey-to-claim conversion workflow.',
    },
    {
      name: 'Documents & BYTEA Storage',
      description: 'Direct-to-PostgreSQL binary document uploads (BYTEA), authenticated downloads, inline previews, and multi-filter metadata search.',
    },
    {
      name: 'Dashboard & Analytics',
      description: 'Executive KPIs, aggregated claim and survey metrics, and combined financial tally analysis (MID & Admin only).',
    },
    {
      name: 'User Administration',
      description: 'Administrative user listing and RBAC role reassignment (Admin only).',
    },
    {
      name: 'Logistics LMS Integration',
      description: 'Bill of Lading verification and container metadata preloading from LMS mock datasets.',
    },
    {
      name: 'Currency & Exchange Rates',
      description: 'Live exchange rates from Frankfurter API with PostgreSQL UPSERT caching and fallback cooldown mechanisms.',
    },
    {
      name: 'Notifications',
      description: 'In-app event notifications for claim assignments, status updates, and closures.',
    },
    {
      name: 'Email Service',
      description: 'Outbound transactional email service configuration and delivery status diagnostics.',
    },
    {
      name: 'System Health & Probes',
      description: 'Unauthenticated liveness, readiness, and comprehensive health monitoring endpoints.',
    },
  ],
  paths: {
    // ─────────────────────────────────────────────────────────────
    // AUTHENTICATION & SECURITY
    // ─────────────────────────────────────────────────────────────
    '/api/auth/register': {
      post: {
        tags: ['Authentication & Security'],
        summary: 'Register new user account',
        description: 'Creates a new user with unverified status (\`is_verified = 0\`) and automatically dispatches a 6-digit cryptographic OTP to the provided email. Public registration strictly assigns the least-privilege \`agency\` role.',
        operationId: 'registerUser',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/RegisterRequest',
              },
            },
          },
        },
        responses: {
          201: {
            description: 'User registered successfully; verification OTP dispatched.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/RegisterResponse',
                },
              },
            },
          },
          400: {
            description: 'Validation failure (weak password, missing fields, or duplicate email).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/ErrorResponse',
                },
                example: {
                  error: 'Password must be at least 8 characters in length and contain at least one letter and one number.',
                },
              },
            },
          },
          429: {
            description: 'Rate limit exceeded (authRateLimiter: 30 requests / 15 min).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/ErrorResponse',
                },
              },
            },
          },
        },
      },
    },
    '/api/auth/verify-otp': {
      post: {
        tags: ['Authentication & Security'],
        summary: 'Verify registration OTP code',
        description: 'Validates the 6-digit one-time password against the cryptographic SHA-256 hash stored in PostgreSQL. Upon successful verification, sets \`is_verified = 1\` and returns a 7-day Bearer JWT session token.',
        operationId: 'verifyOtp',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/VerifyOtpRequest',
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Account verified successfully; JWT session token issued.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/LoginResponse',
                },
              },
            },
          },
          400: {
            description: 'Invalid OTP code, expired OTP, or maximum attempts exceeded.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/ErrorResponse',
                },
                example: {
                  error: 'Invalid verification code. 4 attempts remaining.',
                  attempts_remaining: 4,
                },
              },
            },
          },
          429: {
            description: 'Rate limit exceeded (sensitiveAuthLimiter: 15 requests / 15 min).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/ErrorResponse',
                },
              },
            },
          },
        },
      },
    },
    '/api/auth/resend-otp': {
      post: {
        tags: ['Authentication & Security'],
        summary: 'Resend fresh verification OTP',
        description: 'Generates a new 6-digit cryptographic OTP, invalidates prior active codes, and dispatches the code to the user. Enforces a mandatory 60-second cooldown between requests.',
        operationId: 'resendOtp',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/ResendOtpRequest',
              },
            },
          },
        },
        responses: {
          200: {
            description: 'New verification OTP generated and dispatched.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/ResendOtpResponse',
                },
              },
            },
          },
          400: {
            description: 'Account already verified or email missing.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/ErrorResponse',
                },
              },
            },
          },
          404: {
            description: 'User with specified email not found.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/ErrorResponse',
                },
              },
            },
          },
          429: {
            description: 'Resend cooldown in effect (must wait before requesting again).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/ErrorResponse',
                },
                example: {
                  error: 'Please wait 45 seconds before requesting another verification code.',
                  retry_after_seconds: 45,
                },
              },
            },
          },
        },
      },
    },
    '/api/auth/login': {
      post: {
        tags: ['Authentication & Security'],
        summary: 'User login & session token issuance',
        description: 'Authenticates user credentials using bcrypt. Unverified accounts (\`is_verified = 0\`) are blocked from logging in with a 403 Forbidden status and a \`needs_otp\` flag.',
        operationId: 'loginUser',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/LoginRequest',
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Authenticated successfully; returns JWT token and user profile.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/LoginResponse',
                },
              },
            },
          },
          401: {
            description: 'Invalid credentials or unauthorized.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/ErrorResponse',
                },
                example: {
                  error: 'Invalid email or password',
                },
              },
            },
          },
          403: {
            description: 'Account unverified; requires OTP verification before login.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    error: { type: 'string', example: 'Account not verified. Please complete email verification.' },
                    needs_otp: { type: 'boolean', example: true },
                    email: { type: 'string', example: 'user@example.com' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/auth/forgot-password': {
      post: {
        tags: ['Authentication & Security'],
        summary: 'Request password reset token',
        description: 'Initiates a password reset flow. Employs strict anti-enumeration measures: returns an identical success message regardless of whether the email exists in the database.',
        operationId: 'forgotPassword',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/ForgotPasswordRequest',
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Generic success response (anti-enumeration protected).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/ForgotPasswordResponse',
                },
              },
            },
          },
        },
      },
    },
    '/api/auth/reset-password': {
      post: {
        tags: ['Authentication & Security'],
        summary: 'Reset password using secret token',
        description: 'Validates the single-use 32-byte hexadecimal token against PostgreSQL \`password_resets\`. Updates the password hash, increments the user \`token_version\` (invalidating all existing JWT sessions), and marks the token as used.',
        operationId: 'resetPassword',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/ResetPasswordRequest',
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Password reset successful; all prior sessions revoked.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    message: { type: 'string', example: 'Password reset successful. Please log in with your new password.' },
                  },
                },
              },
            },
          },
          400: {
            description: 'Invalid token, expired token (valid for 1 hour), or weak password.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/ErrorResponse',
                },
              },
            },
          },
        },
      },
    },
    '/api/auth/google': {
      post: {
        tags: ['Authentication & Security'],
        summary: 'Google OAuth login / registration (simulated)',
        description: 'Simulated OAuth handshake for development and test environments. Finds or creates an account matching the email with \`agency\` role and issues a JWT session token.',
        operationId: 'googleAuth',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/GoogleAuthRequest',
              },
            },
          },
        },
        responses: {
          200: {
            description: 'OAuth authentication successful.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/LoginResponse',
                },
              },
            },
          },
        },
      },
    },
    '/api/auth/me': {
      get: {
        tags: ['Authentication & Security'],
        summary: 'Get current user profile',
        description: 'Returns the active user profile for the current JWT session. Validates that the token version matches the database record.',
        operationId: 'getCurrentUser',
        security: [{ bearerAuth: [] }],
        responses: {
          200: {
            description: 'Current user profile.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/UserProfile',
                },
              },
            },
          },
          401: {
            description: 'Unauthenticated or session invalidated (e.g. following password change).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/ErrorResponse',
                },
              },
            },
          },
        },
      },
    },

    // ─────────────────────────────────────────────────────────────
    // CARGO CLAIMS
    // ─────────────────────────────────────────────────────────────
    '/api/claims': {
      get: {
        tags: ['Cargo Claims'],
        summary: 'List cargo claims with search and RLS',
        description: 'Retrieves claims filtered by search query or status. Enforces Row-Level Security: external \`agency\` users strictly retrieve only claims they created (\`created_by_id = user.id\`). PIL internal handlers (\`mid\`, \`mid_gcc\`, \`admin\`) can view all claims across all agencies.',
        operationId: 'getClaims',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'search',
            in: 'query',
            description: 'Search string matching claim_number, bl_number, claimant, or cms_number',
            required: false,
            schema: { type: 'string' },
          },
          {
            name: 'status',
            in: 'query',
            description: 'Filter by workflow status',
            required: false,
            schema: {
              type: 'string',
              enum: ['new_claim', 'pre_claim', 'in_progress', 'awaiting_input', 'awaiting_approval', 'closed'],
            },
          },
        ],
        responses: {
          200: {
            description: 'List of matching claim records.',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/Claim' },
                },
              },
            },
          },
          401: {
            description: 'Authentication required.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
        },
      },
      post: {
        tags: ['Cargo Claims'],
        summary: 'Create new cargo claim',
        description: 'Creates a new cargo claim. Automatically allocates a sequential claim number in \`CLM-YYYY-XXXX\` format and computes the legal 1-year time bar from the cargo discharge date. For agency users, status is locked to \`new_claim\` and \`cms_number\` is held as null until MID review.',
        operationId: 'createClaim',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/ClaimCreateRequest',
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Claim created successfully.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Claim' },
              },
            },
          },
          400: {
            description: 'Missing mandatory fields (bl_number and claimant are required).',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
          401: {
            description: 'Authentication required.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
        },
      },
    },
    '/api/claims/{id}': {
      get: {
        tags: ['Cargo Claims'],
        summary: 'Get single claim by ID',
        description: 'Retrieves complete claim details including embedded tally arrays, linked survey records, and field-level change history. Enforces RLS: agencies receive 403 Forbidden if attempting to access another agency’s claim.',
        operationId: 'getClaimById',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            description: 'Unique internal ID of the claim (e.g. \`clm-1793084136\`)',
            schema: { type: 'string' },
          },
        ],
        responses: {
          200: {
            description: 'Complete claim entity with linked surveys.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Claim' },
              },
            },
          },
          403: {
            description: 'Access denied: You do not have permission to view this claim (RLS violation).',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
          404: {
            description: 'Claim not found.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
        },
      },
      put: {
        tags: ['Cargo Claims'],
        summary: 'Update claim record',
        description: 'Updates claim metadata. Workflow status transitions, CMS reference assignment, handler assignment, and legal time-bar modifications are restricted to MID/Admin handlers. Appending internal comments or expense/recovery items generates automatic audit log rows.',
        operationId: 'updateClaim',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            description: 'Unique internal ID of the claim',
            schema: { type: 'string' },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ClaimUpdateRequest' },
            },
          },
        },
        responses: {
          200: {
            description: 'Claim updated successfully.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Claim' },
              },
            },
          },
          403: {
            description: 'Permission denied: Unauthorized field modification or RLS violation.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
          404: {
            description: 'Claim not found.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
        },
      },
      delete: {
        tags: ['Cargo Claims'],
        summary: 'Delete claim record',
        description: 'Deletes a claim record from PostgreSQL. Restricted to \`mid\`, \`mid_gcc\`, and \`admin\` roles. Agency roles receive 403 Forbidden.',
        operationId: 'deleteClaim',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            description: 'Unique internal ID of the claim',
            schema: { type: 'string' },
          },
        ],
        responses: {
          200: {
            description: 'Claim deleted successfully.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { success: { type: 'boolean', example: true } },
                },
              },
            },
          },
          403: {
            description: 'Access denied: Agency role cannot delete claims.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
          404: {
            description: 'Claim not found.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
        },
      },
    },
    '/api/claims/{id}/audit': {
      get: {
        tags: ['Cargo Claims'],
        summary: 'Retrieve audit logs for claim',
        description: 'Returns the chronological field-level change history for the specified claim, detailing previous and updated values, the user ID and name of the actor, and timestamps.',
        operationId: 'getClaimAuditLogs',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            description: 'Unique internal ID of the claim',
            schema: { type: 'string' },
          },
        ],
        responses: {
          200: {
            description: 'Audit log entries.',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/AuditLogEntry' },
                },
              },
            },
          },
          403: {
            description: 'RLS violation: Cannot view audit log of another agency’s claim.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
          404: {
            description: 'Claim not found.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
        },
      },
    },

    // ─────────────────────────────────────────────────────────────
    // SURVEYS
    // ─────────────────────────────────────────────────────────────
    '/api/surveys': {
      get: {
        tags: ['Surveys'],
        summary: 'List surveys with search and RLS',
        description: 'Retrieves independent survey requests. Enforces RLS: agencies view only their own created surveys; MID/Admin users view all surveys.',
        operationId: 'getSurveys',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'search',
            in: 'query',
            description: 'Filter by survey_number, bl_number, or survey_requested_by',
            schema: { type: 'string' },
          },
          {
            name: 'status',
            in: 'query',
            description: 'Filter by survey status',
            schema: {
              type: 'string',
              enum: ['new_survey', 'appointed', 'pending', 'rejected'],
            },
          },
        ],
        responses: {
          200: {
            description: 'List of matching survey records.',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/Survey' },
                },
              },
            },
          },
        },
      },
      post: {
        tags: ['Surveys'],
        summary: 'Create independent survey request',
        description: 'Registers a new cargo inspection survey. Automatically assigns sequential number format \`SVY-YYYY-XXXX\`.',
        operationId: 'createSurvey',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/SurveyCreateRequest' },
            },
          },
        },
        responses: {
          201: {
            description: 'Survey created successfully.',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Survey' } },
            },
          },
          400: {
            description: 'Missing required survey parameters.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
        },
      },
    },
    '/api/surveys/{id}': {
      get: {
        tags: ['Surveys'],
        summary: 'Get survey details by ID',
        description: 'Fetches survey record. Agency users can access only their own surveys.',
        operationId: 'getSurveyById',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          200: {
            description: 'Survey record details.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Survey' } } },
          },
          403: {
            description: 'Access denied (RLS).',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
          404: {
            description: 'Survey not found.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
        },
      },
      put: {
        tags: ['Surveys'],
        summary: 'Update survey record',
        description: 'Updates survey information. Status changes and CMS number assignments are restricted to MID/Admin roles.',
        operationId: 'updateSurvey',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/SurveyUpdateRequest' } },
          },
        },
        responses: {
          200: {
            description: 'Survey updated successfully.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Survey' } } },
          },
        },
      },
    },
    '/api/surveys/{id}/convert-to-claim': {
      post: {
        tags: ['Surveys'],
        summary: 'Convert survey to cargo claim',
        description: 'Atomic workflow converting an appointed or accepted survey into a full cargo claim. Copies all shipment, container, and cargo damage attributes to the new claim, marks the survey with \`converted_to_claim_id\`, and writes dual audit log entries. Restricted to \`mid\`, \`mid_gcc\`, and \`admin\`.',
        operationId: 'convertSurveyToClaim',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            description: 'ID of the survey to convert',
            schema: { type: 'string' },
          },
        ],
        responses: {
          201: {
            description: 'Survey converted to claim successfully.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    claim: { $ref: '#/components/schemas/Claim' },
                    survey: { $ref: '#/components/schemas/Survey' },
                  },
                },
              },
            },
          },
          400: {
            description: 'Survey is not in an appointed/accepted state or has already been converted.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
          403: {
            description: 'Permission denied: Agency users cannot convert surveys.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
        },
      },
    },

    // ─────────────────────────────────────────────────────────────
    // DOCUMENTS & BYTEA STORAGE
    // ─────────────────────────────────────────────────────────────
    '/api/upload': {
      post: {
        tags: ['Documents & BYTEA Storage'],
        summary: 'Upload document directly to PostgreSQL BYTEA',
        description: 'Ingests uploaded multipart form data files straight into memory and writes binary data to PostgreSQL \`attachment_contents\` (\`BYTEA\`). Performs magic-byte inspection (PDF, PNG, JPEG), file extension whitelisting, filename sanitization, and computes SHA-256 integrity checksums. Max file size: 25MB.',
        operationId: 'uploadDocument',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['file'],
                properties: {
                  file: {
                    type: 'string',
                    format: 'binary',
                    description: 'The file payload to upload (max 25MB).',
                  },
                  claim_id: {
                    type: 'string',
                    description: 'Optional ID of the claim to associate with this document.',
                  },
                  survey_id: {
                    type: 'string',
                    description: 'Optional ID of the survey to associate with this document.',
                  },
                  mandatory_attachment_type: {
                    type: 'string',
                    description: 'Optional category tag (e.g. \`Bill of Lading\`, \`Survey Report\`, \`Commercial Invoice\`).',
                  },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'File securely ingested and committed to database.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/AttachmentUploadResponse' },
              },
            },
          },
          400: {
            description: 'File validation error (size > 25MB, blocked executable extension, or invalid magic bytes).',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
          429: {
            description: 'Upload rate limit exceeded (uploadRateLimiter: 60 uploads / 15 min).',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
        },
      },
    },
    '/api/files/{id}/download': {
      get: {
        tags: ['Documents & BYTEA Storage'],
        summary: 'Download document binary (Content-Disposition: attachment)',
        description: 'Retrieves binary BYTEA data from PostgreSQL and forces browser download. Requires active Bearer JWT token and enforces RLS: agency users cannot download documents attached to claims belonging to other agencies.',
        operationId: 'downloadAttachment',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            description: 'Document UUID or stored filename identifier',
            schema: { type: 'string' },
          },
        ],
        responses: {
          200: {
            description: 'Binary document payload with \`Content-Disposition: attachment\`.',
            headers: {
              'Content-Type': { schema: { type: 'string', example: 'application/pdf' } },
              'Content-Length': { schema: { type: 'integer', example: 1048576 } },
              'Content-Disposition': { schema: { type: 'string', example: 'attachment; filename="survey_report.pdf"' } },
              'X-Content-Type-Options': { schema: { type: 'string', example: 'nosniff' } },
            },
            content: {
              'application/octet-stream': {
                schema: { type: 'string', format: 'binary' },
              },
            },
          },
          401: {
            description: 'Authentication required: Token missing or invalid.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
          403: {
            description: 'Access denied: RLS authorization failed for this document.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
          404: {
            description: 'Document not found in storage.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
        },
      },
    },
    '/api/files/{id}/preview': {
      get: {
        tags: ['Documents & BYTEA Storage'],
        summary: 'Preview document inline in browser (Content-Disposition: inline)',
        description: 'Delivers binary document data with \`Content-Disposition: inline\` to enable direct rendering inside browser tabs or iframe modals (e.g. PDF view, image view). Enforces path traversal protection and RLS checks.',
        operationId: 'previewAttachment',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          200: {
            description: 'Binary payload rendered inline.',
            content: {
              'application/pdf': { schema: { type: 'string', format: 'binary' } },
              'image/png': { schema: { type: 'string', format: 'binary' } },
              'image/jpeg': { schema: { type: 'string', format: 'binary' } },
            },
          },
          401: {
            description: 'Authentication required.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
          403: {
            description: 'Access denied (RLS).',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
          404: {
            description: 'Document not found.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
        },
      },
    },
    '/api/files/{filename}': {
      get: {
        tags: ['Documents & BYTEA Storage'],
        summary: 'Retrieve document by stored filename (legacy fallback)',
        description: 'Lookup and serve document by its stored filename identifier directly from PostgreSQL BYTEA storage. Applies query parameter \`?download=1\` to toggle between inline preview and attachment download.',
        operationId: 'serveAttachmentByFilename',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'filename',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
          {
            name: 'download',
            in: 'query',
            required: false,
            description: 'Set to 1 to force download header, 0 or omitted for inline preview',
            schema: { type: 'string', enum: ['0', '1'] },
          },
        ],
        responses: {
          200: {
            description: 'Binary payload served from database.',
            content: {
              'application/octet-stream': { schema: { type: 'string', format: 'binary' } },
            },
          },
          403: {
            description: 'Access denied.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
          404: {
            description: 'File not found.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
        },
      },
    },
    '/uploads/{id}/download': {
      get: {
        tags: ['Documents & BYTEA Storage'],
        summary: 'Legacy alias for document download',
        description: 'Alias route mapping to \`/api/files/{id}/download\` for backwards compatibility with earlier frontend components.',
        operationId: 'legacyDownload',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          200: {
            description: 'Binary file payload.',
            content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } },
          },
        },
      },
    },
    '/uploads/{id}/preview': {
      get: {
        tags: ['Documents & BYTEA Storage'],
        summary: 'Legacy alias for document preview',
        description: 'Alias route mapping to \`/api/files/{id}/preview\` for backwards compatibility.',
        operationId: 'legacyPreview',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          200: {
            description: 'Inline binary document payload.',
            content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } },
          },
        },
      },
    },
    '/uploads/{filename}': {
      get: {
        tags: ['Documents & BYTEA Storage'],
        summary: 'Legacy alias for document retrieval by filename',
        description: 'Alias route mapping to \`/api/files/{filename}\`.',
        operationId: 'legacyFilename',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'filename',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          200: {
            description: 'Binary payload served from database.',
            content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } },
          },
        },
      },
    },
    '/api/attachments/search': {
      get: {
        tags: ['Documents & BYTEA Storage'],
        summary: 'Multi-filter document search with pagination',
        description: 'Searches document metadata across claims, surveys, and container records. Enforces RLS: agencies discover only documents attached to their own claims.',
        operationId: 'searchAttachments',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'query', in: 'query', description: 'General keyword search matching filename or reference numbers', schema: { type: 'string' } },
          { name: 'bl_number', in: 'query', description: 'Filter by Bill of Lading number', schema: { type: 'string' } },
          { name: 'claim_number', in: 'query', description: 'Filter by Claim Number (e.g. CLM-2026-0001)', schema: { type: 'string' } },
          { name: 'survey_number', in: 'query', description: 'Filter by Survey Number', schema: { type: 'string' } },
          { name: 'cms_number', in: 'query', description: 'Filter by CMS Reference Number', schema: { type: 'string' } },
          { name: 'document_type', in: 'query', description: 'Filter by document type (e.g. Bill of Lading, Survey Report)', schema: { type: 'string' } },
          { name: 'page', in: 'query', description: 'Page number (default: 1)', schema: { type: 'integer', default: 1 } },
          { name: 'limit', in: 'query', description: 'Items per page (default: 10, max: 100)', schema: { type: 'integer', default: 10 } },
        ],
        responses: {
          200: {
            description: 'Paginated document metadata search results (binary BYTEA excluded for efficiency).',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/AttachmentSearchResponse' },
              },
            },
          },
        },
      },
    },
    '/api/attachments/types': {
      get: {
        tags: ['Documents & BYTEA Storage'],
        summary: 'List distinct document types',
        description: 'Returns unique document types present in the database, filtered by user RLS permissions, for populating filter dropdowns.',
        operationId: 'getDocumentTypes',
        security: [{ bearerAuth: [] }],
        responses: {
          200: {
            description: 'List of document types.',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { type: 'string' },
                  example: ['Bill of Lading', 'Commercial Invoice', 'Survey Report', 'Packing List', 'Photos'],
                },
              },
            },
          },
        },
      },
    },
    '/api/attachments/{id}': {
      get: {
        tags: ['Documents & BYTEA Storage'],
        summary: 'Get single document metadata',
        description: 'Retrieves metadata (filename, size, type, upload timestamp, associated claim/survey) for a specific document. Verifies RLS ownership.',
        operationId: 'getAttachmentMetadata',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          200: {
            description: 'Document metadata entity.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/AttachmentMetadata' },
              },
            },
          },
          403: {
            description: 'Access denied: RLS permission check failed.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
          404: {
            description: 'Document not found.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
        },
      },
    },

    // ─────────────────────────────────────────────────────────────
    // DASHBOARD & ANALYTICS
    // ─────────────────────────────────────────────────────────────
    '/api/dashboard/metrics': {
      get: {
        tags: ['Dashboard & Analytics'],
        summary: 'Aggregated claims and survey metrics',
        description: 'Calculates high-level KPIs: total claims, open/closed counts, breakdown by SLA status (green/amber/red), survey counts, and aggregated expense vs recovery tallies across all currencies. Accessible strictly to \`mid\`, \`mid_gcc\`, and \`admin\` roles. Agency role receives 403 Forbidden.',
        operationId: 'getDashboardMetrics',
        security: [{ bearerAuth: [] }],
        responses: {
          200: {
            description: 'Aggregated metric data and chart series.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/DashboardMetrics' },
              },
            },
          },
          403: {
            description: 'Access denied: Agency role cannot view executive dashboard metrics.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
        },
      },
    },

    // ─────────────────────────────────────────────────────────────
    // USER ADMINISTRATION
    // ─────────────────────────────────────────────────────────────
    '/api/users': {
      get: {
        tags: ['User Administration'],
        summary: 'List all user accounts',
        description: 'Returns all system users. Excludes password hashes. Restricted strictly to \`admin\` role.',
        operationId: 'getUsers',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'search',
            in: 'query',
            description: 'Search string matching user full_name or email',
            schema: { type: 'string' },
          },
        ],
        responses: {
          200: {
            description: 'List of registered users.',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/UserProfile' },
                },
              },
            },
          },
          403: {
            description: 'Forbidden: Requires admin role.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
        },
      },
    },
    '/api/users/{id}/role': {
      put: {
        tags: ['User Administration'],
        summary: 'Modify user RBAC role',
        description: 'Changes a user’s role to one of: \`agency\`, \`mid\`, \`mid_gcc\`, or \`admin\`. Generates an audit log entry. Restricted strictly to \`admin\` role.',
        operationId: 'updateUserRole',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            description: 'User ID to update',
            schema: { type: 'string' },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['role'],
                properties: {
                  role: {
                    type: 'string',
                    enum: ['agency', 'mid', 'mid_gcc', 'admin'],
                    example: 'mid',
                  },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'User role updated successfully.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    user: { $ref: '#/components/schemas/UserProfile' },
                  },
                },
              },
            },
          },
          400: {
            description: 'Invalid role provided.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
          403: {
            description: 'Forbidden: Requires admin role.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
          404: {
            description: 'User not found.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
        },
      },
    },

    // ─────────────────────────────────────────────────────────────
    // LOGISTICS LMS INTEGRATION
    // ─────────────────────────────────────────────────────────────
    '/api/lms/lookup': {
      get: {
        tags: ['Logistics LMS Integration'],
        summary: 'Lookup Bill of Lading in LMS data',
        description: 'Fetches shipment details, vessel info, routing, and container manifests for a specified Bill of Lading number. Reads from in-memory preloaded Excel mock data with PostgreSQL \`lms_cache\` backing.',
        operationId: 'lookupLms',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'bl_number',
            in: 'query',
            required: true,
            description: 'Bill of Lading identifier (e.g. \`PILU1234567\`)',
            schema: { type: 'string', example: 'PILU1234567' },
          },
        ],
        responses: {
          200: {
            description: 'LMS shipment details and associated containers.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/LmsLookupResponse' },
              },
            },
          },
          400: {
            description: 'bl_number parameter missing.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
          404: {
            description: 'Bill of Lading not found in LMS records.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
        },
      },
    },

    // ─────────────────────────────────────────────────────────────
    // CURRENCY RATES (FRANKFURTER)
    // ─────────────────────────────────────────────────────────────
    '/api/rates': {
      get: {
        tags: ['Currency & Exchange Rates'],
        summary: 'Get daily exchange rates (Frankfurter live API + cache)',
        description: 'Returns live USD-based conversion rates for SGD, EUR, GBP, INR, AED, and CNY. Checks PostgreSQL \`currency_rates\` table for today’s snapshot, queries \`https://api.frankfurter.app\` on cache miss, and caches the result via UPSERT (\`ON CONFLICT (id) DO UPDATE\`). If the external API is unreachable, automatically uses hardcoded fallback rates and applies a 5-minute cooldown to prevent API hammering.',
        operationId: 'getExchangeRates',
        security: [{ bearerAuth: [] }],
        responses: {
          200: {
            description: 'Exchange rate figures and data source metadata.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ExchangeRatesResult' },
              },
            },
          },
        },
      },
    },

    // ─────────────────────────────────────────────────────────────
    // NOTIFICATIONS
    // ─────────────────────────────────────────────────────────────
    '/api/notifications': {
      get: {
        tags: ['Notifications'],
        summary: 'List user notifications',
        description: 'Returns the 50 most recent in-app notifications addressed to the authenticated user or broadcast to all users.',
        operationId: 'getNotifications',
        security: [{ bearerAuth: [] }],
        responses: {
          200: {
            description: 'List of notifications.',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/Notification' },
                },
              },
            },
          },
        },
      },
    },
    '/api/notifications/{id}/read': {
      put: {
        tags: ['Notifications'],
        summary: 'Mark notification as read',
        description: 'Updates a notification record to set \`read = 1\`.',
        operationId: 'markNotificationRead',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            description: 'Notification ID',
            schema: { type: 'string' },
          },
        ],
        responses: {
          200: {
            description: 'Notification marked as read.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { success: { type: 'boolean', example: true } },
                },
              },
            },
          },
        },
      },
    },

    // ─────────────────────────────────────────────────────────────
    // EMAIL SERVICE STATUS
    // ─────────────────────────────────────────────────────────────
    '/api/email/status': {
      get: {
        tags: ['Email Service'],
        summary: 'Get email provider configuration & diagnostic status',
        description: 'Returns current email transport status (\`captured_test\`, \`smtp\`, or \`ms_graph\`) and flags whether required environment credentials are fully configured.',
        operationId: 'getEmailStatus',
        security: [{ bearerAuth: [] }],
        responses: {
          200: {
            description: 'Email subsystem status details.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/EmailProviderStatus' },
              },
            },
          },
        },
      },
    },

    // ─────────────────────────────────────────────────────────────
    // SYSTEM HEALTH & PROBES
    // ─────────────────────────────────────────────────────────────
    '/api/health/live': {
      get: {
        tags: ['System Health & Probes'],
        summary: 'Liveness probe (process running)',
        description: 'Lightweight unauthenticated probe indicating that the Node.js Express process is active and accepting requests.',
        operationId: 'getHealthLive',
        responses: {
          200: {
            description: 'Process is alive.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', example: 'ok' },
                    timestamp: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/health/ready': {
      get: {
        tags: ['System Health & Probes'],
        summary: 'Readiness probe (database connectivity)',
        description: 'Checks connectivity to the PostgreSQL 17 database pool. Returns HTTP 200 when ready to serve traffic or HTTP 503 if disconnected.',
        operationId: 'getHealthReady',
        responses: {
          200: {
            description: 'Database connected and application ready.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', example: 'ready' },
                    database: { type: 'string', example: 'connected' },
                    timestamp: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
          503: {
            description: 'Database disconnected or pool exhausted.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', example: 'not_ready' },
                    database: { type: 'string', example: 'disconnected' },
                    timestamp: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/health': {
      get: {
        tags: ['System Health & Probes'],
        summary: 'Comprehensive system health probe',
        description: 'Returns application uptime in seconds, package version, active environment (\`development\` / \`production\`), and PostgreSQL pool status.',
        operationId: 'getHealthFull',
        responses: {
          200: {
            description: 'System health snapshot.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', enum: ['healthy', 'degraded'], example: 'healthy' },
                    version: { type: 'string', example: '1.0.0' },
                    uptime: { type: 'integer', description: 'Uptime in seconds', example: 3600 },
                    database: { type: 'string', enum: ['connected', 'disconnected'], example: 'connected' },
                    environment: { type: 'string', example: 'development' },
                    timestamp: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Enter your 7-day JWT session token obtained via \`/api/auth/login\` or \`/api/auth/verify-otp\`.',
      },
    },
    schemas: {
      // ─── AUTH SCHEMAS ───
      RegisterRequest: {
        type: 'object',
        required: ['full_name', 'email', 'password'],
        properties: {
          full_name: { type: 'string', example: 'Alfred Tan' },
          email: { type: 'string', format: 'email', example: 'alfred.tan@pilship.com' },
          password: { type: 'string', format: 'password', example: 'SecureP@ssw0rd2026' },
        },
      },
      RegisterResponse: {
        type: 'object',
        properties: {
          message: { type: 'string', example: 'Registration successful. A 6-digit verification code has been dispatched to your email address.' },
          email: { type: 'string', example: 'alfred.tan@pilship.com' },
          resend_cooldown_seconds: { type: 'integer', example: 60 },
          expires_in_seconds: { type: 'integer', example: 600 },
          email_delivery_status: { type: 'string', example: 'captured_test' },
        },
      },
      VerifyOtpRequest: {
        type: 'object',
        required: ['email', 'otp'],
        properties: {
          email: { type: 'string', format: 'email', example: 'alfred.tan@pilship.com' },
          otp: { type: 'string', pattern: '^\\d{6}$', example: '729401' },
        },
      },
      ResendOtpRequest: {
        type: 'object',
        required: ['email'],
        properties: {
          email: { type: 'string', format: 'email', example: 'alfred.tan@pilship.com' },
        },
      },
      ResendOtpResponse: {
        type: 'object',
        properties: {
          message: { type: 'string', example: 'A new 6-digit verification code has been dispatched to your email address.' },
          email: { type: 'string', example: 'alfred.tan@pilship.com' },
          resend_cooldown_seconds: { type: 'integer', example: 60 },
          expires_in_seconds: { type: 'integer', example: 600 },
          email_delivery_status: { type: 'string', example: 'captured_test' },
        },
      },
      LoginRequest: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string', format: 'email', example: 'admin@pilship.com' },
          password: { type: 'string', format: 'password', example: 'Password123!' },
        },
      },
      LoginResponse: {
        type: 'object',
        properties: {
          token: { type: 'string', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' },
          user: { $ref: '#/components/schemas/UserProfile' },
        },
      },
      UserProfile: {
        type: 'object',
        properties: {
          id: { type: 'string', example: 'usr-admin-01' },
          email: { type: 'string', format: 'email', example: 'admin@pilship.com' },
          full_name: { type: 'string', example: 'System Administrator' },
          role: { type: 'string', enum: ['agency', 'mid', 'mid_gcc', 'admin'], example: 'admin' },
          is_verified: { type: 'integer', enum: [0, 1], example: 1 },
          created_date: { type: 'string', format: 'date-time' },
        },
      },
      ForgotPasswordRequest: {
        type: 'object',
        required: ['email'],
        properties: {
          email: { type: 'string', format: 'email', example: 'user@example.com' },
        },
      },
      ForgotPasswordResponse: {
        type: 'object',
        properties: {
          message: { type: 'string', example: 'If an account matching that email address exists, a secure password reset link has been dispatched.' },
        },
      },
      ResetPasswordRequest: {
        type: 'object',
        required: ['token', 'new_password'],
        properties: {
          token: { type: 'string', example: 'a4b2c89012de34f567890123456789abcdef0123456789abcdef0123456789ab' },
          new_password: { type: 'string', format: 'password', example: 'NewSecurePass2026!' },
        },
      },
      GoogleAuthRequest: {
        type: 'object',
        required: ['email'],
        properties: {
          email: { type: 'string', format: 'email', example: 'user.google@gmail.com' },
          full_name: { type: 'string', example: 'Google User' },
        },
      },

      // ─── CLAIM SCHEMAS ───
      Claim: {
        type: 'object',
        properties: {
          id: { type: 'string', example: 'clm-1793084136' },
          claim_number: { type: 'string', example: 'CLM-2026-0001' },
          cms_number: { type: 'string', nullable: true, example: 'CMS-2026-8841' },
          bl_number: { type: 'string', example: 'PILU1234567' },
          shipper: { type: 'string', example: 'Singapore Agro Exports Pte Ltd' },
          consignee: { type: 'string', example: 'Dubai Food Imports LLC' },
          notify_party: { type: 'string', example: 'Gulf Logistics Hub' },
          place_of_receipt: { type: 'string', example: 'Jurong Port, Singapore' },
          port_of_loading: { type: 'string', example: 'Singapore' },
          port_of_discharge: { type: 'string', example: 'Jebel Ali, Dubai' },
          place_of_delivery: { type: 'string', example: 'Dubai Logistics City' },
          vessel_code: { type: 'string', example: 'KOTA' },
          vessel_name: { type: 'string', example: 'KOTA LAHIR' },
          vessel_voyage: { type: 'string', example: 'V.0142W' },
          commodity: { type: 'string', example: 'Refined Palm Oil in Flexitanks' },
          container_number: { type: 'string', example: 'PCIU8912340' },
          container_size: { type: 'string', example: '20ft' },
          seal_number: { type: 'string', example: 'PIL-99214' },
          weight: { type: 'number', example: 21500.0 },
          quantity: { type: 'number', example: 1.0 },
          package_type: { type: 'string', example: 'Flexitank' },
          discharge_date: { type: 'string', example: '2026-05-01' },
          claim_amount: { type: 'number', example: 12500.0 },
          claimant: { type: 'string', example: 'Dubai Food Imports LLC' },
          claimant_type: { type: 'string', example: 'Consignee' },
          status: {
            type: 'string',
            enum: ['new_claim', 'pre_claim', 'in_progress', 'awaiting_input', 'awaiting_approval', 'closed'],
            example: 'in_progress',
          },
          sla_status: { type: 'string', enum: ['green', 'amber', 'red'], example: 'green' },
          time_bar_date: { type: 'string', example: '2027-05-01' },
          claims_handler: { type: 'string', example: 'Alfred Tan' },
          cargo_type: { type: 'string', enum: ['dry', 'reefer'], example: 'dry' },
          selected_containers: { type: 'string', example: '["PCIU8912340"]' },
          expense_tally_records: { type: 'string', example: '[]' },
          recovery_tally_records: { type: 'string', example: '[]' },
          comments: { type: 'string', example: '[]' },
          attachments: { type: 'string', example: '[]' },
          created_by_id: { type: 'string', example: 'usr-agency-01' },
          created_date: { type: 'string', format: 'date-time' },
        },
      },
      ClaimCreateRequest: {
        type: 'object',
        required: ['bl_number', 'claimant'],
        properties: {
          bl_number: { type: 'string', example: 'PILU1234567' },
          claimant: { type: 'string', example: 'Dubai Food Imports LLC' },
          claimant_type: { type: 'string', example: 'Consignee' },
          claim_amount: { type: 'number', example: 8500.0 },
          discharge_date: { type: 'string', example: '2026-05-01' },
          commodity: { type: 'string', example: 'Electronics in Cartons' },
          vessel_name: { type: 'string', example: 'KOTA LAHIR' },
          incident_description: { type: 'string', example: 'Water damage observed upon destuffing.' },
          cargo_type: { type: 'string', enum: ['dry', 'reefer'], default: 'dry' },
        },
      },
      ClaimUpdateRequest: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['new_claim', 'pre_claim', 'in_progress', 'awaiting_input', 'awaiting_approval', 'closed'],
            description: 'Can only be modified by MID/Admin roles.',
          },
          cms_number: { type: 'string', description: 'Can only be assigned by MID/Admin roles.' },
          claims_handler: { type: 'string', description: 'Assigned handler (MID/Admin only).' },
          claim_amount: { type: 'number', example: 9200.0 },
          awaiting_input_reason: { type: 'string', example: 'Awaiting surveyor final quantification.' },
          closed_reason: { type: 'string', example: 'Settled' },
          comments: { type: 'string', description: 'JSON array string of comments' },
          expense_tally_records: { type: 'string', description: 'JSON array string of expense items' },
          recovery_tally_records: { type: 'string', description: 'JSON array string of recovery items' },
        },
      },

      // ─── SURVEY SCHEMAS ───
      Survey: {
        type: 'object',
        properties: {
          id: { type: 'string', example: 'svy-1793084136' },
          survey_number: { type: 'string', example: 'SVY-2026-0001' },
          survey_reference_number: { type: 'string', example: 'REF-SVY-8812' },
          cms_reference_number: { type: 'string', nullable: true, example: 'CMS-2026-1029' },
          bl_number: { type: 'string', example: 'PILU1234567' },
          survey_requested_by: { type: 'string', example: 'Dubai Port Authority' },
          survey_status: { type: 'string', enum: ['new_survey', 'appointed', 'pending', 'rejected'], example: 'appointed' },
          date_of_survey: { type: 'string', example: '2026-05-02' },
          survey_cost: { type: 'number', example: 1200.0 },
          converted_to_claim_id: { type: 'string', nullable: true },
          converted_to_claim_number: { type: 'string', nullable: true },
          created_by_id: { type: 'string', example: 'usr-agency-01' },
          created_date: { type: 'string', format: 'date-time' },
        },
      },
      SurveyCreateRequest: {
        type: 'object',
        required: ['bl_number', 'survey_reference_number', 'survey_requested_by', 'date_of_survey', 'survey_cost'],
        properties: {
          bl_number: { type: 'string', example: 'PILU1234567' },
          survey_reference_number: { type: 'string', example: 'SURV-DXB-2026-01' },
          survey_requested_by: { type: 'string', example: 'Cargo Underwriters' },
          date_of_survey: { type: 'string', example: '2026-05-04' },
          survey_cost: { type: 'number', example: 950.0 },
          incident_description: { type: 'string', example: 'Container dented and seals broken on port terminal.' },
        },
      },
      SurveyUpdateRequest: {
        type: 'object',
        properties: {
          survey_status: { type: 'string', enum: ['new_survey', 'appointed', 'pending', 'rejected'] },
          cms_reference_number: { type: 'string', example: 'CMS-SVY-9912' },
          survey_cost: { type: 'number', example: 1100.0 },
        },
      },

      // ─── DOCUMENT SCHEMAS ───
      AttachmentMetadata: {
        type: 'object',
        properties: {
          id: { type: 'string', example: 'att-1793084136-ab12' },
          stored_filename: { type: 'string', example: 'survey_report_1793084136.pdf' },
          original_filename: { type: 'string', example: 'Official_Survey_Report.pdf' },
          mime_type: { type: 'string', example: 'application/pdf' },
          file_size: { type: 'integer', example: 421092 },
          checksum: { type: 'string', example: 'edea2a448d88e8d88f8d88a448d88...' },
          claim_id: { type: 'string', nullable: true, example: 'clm-1793084136' },
          claim_number: { type: 'string', nullable: true, example: 'CLM-2026-0001' },
          survey_id: { type: 'string', nullable: true },
          survey_number: { type: 'string', nullable: true },
          bl_number: { type: 'string', example: 'PILU1234567' },
          cms_number: { type: 'string', nullable: true, example: 'CMS-2026-8841' },
          document_type: { type: 'string', example: 'Survey Report' },
          uploaded_by_id: { type: 'string', example: 'usr-agency-01' },
          uploaded_by_name: { type: 'string', example: 'Singapore Port Agency' },
          uploaded_at: { type: 'string', format: 'date-time' },
          file_url: { type: 'string', example: '/api/files/survey_report_1793084136.pdf' },
        },
      },
      AttachmentUploadResponse: {
        type: 'object',
        properties: {
          file_url: { type: 'string', example: '/api/files/survey_report_1793084136.pdf' },
          file_name: { type: 'string', example: 'survey_report_1793084136.pdf' },
          file_size: { type: 'integer', example: 421092 },
          file_type: { type: 'string', example: 'application/pdf' },
          uploaded_by: { type: 'string', example: 'Singapore Port Agency' },
          uploaded_date: { type: 'string', format: 'date-time' },
          attachment_id: { type: 'string', example: 'att-1793084136-ab12' },
          checksum: { type: 'string', example: 'edea2a448d88e8d88f8d88a448d88...' },
        },
      },
      AttachmentSearchResponse: {
        type: 'object',
        properties: {
          data: {
            type: 'array',
            items: { $ref: '#/components/schemas/AttachmentMetadata' },
          },
          pagination: {
            type: 'object',
            properties: {
              page: { type: 'integer', example: 1 },
              limit: { type: 'integer', example: 10 },
              total: { type: 'integer', example: 41 },
              total_pages: { type: 'integer', example: 5 },
            },
          },
        },
      },

      // ─── DASHBOARD SCHEMAS ───
      DashboardMetrics: {
        type: 'object',
        properties: {
          claims: {
            type: 'object',
            properties: {
              total: { type: 'integer', example: 62 },
              open: { type: 'integer', example: 48 },
              closed: { type: 'integer', example: 14 },
              by_status: { type: 'object' },
              sla_breakdown: {
                type: 'object',
                properties: {
                  green: { type: 'integer', example: 42 },
                  amber: { type: 'integer', example: 5 },
                  red: { type: 'integer', example: 15 },
                },
              },
            },
          },
          surveys: {
            type: 'object',
            properties: {
              total: { type: 'integer', example: 24 },
              by_status: { type: 'object' },
            },
          },
          expenses: {
            type: 'object',
            properties: {
              total_amount: { type: 'number', example: 84200.0 },
              settled: { type: 'number', example: 51000.0 },
              outstanding: { type: 'number', example: 33200.0 },
            },
          },
          recoveries: {
            type: 'object',
            properties: {
              total_amount: { type: 'number', example: 45000.0 },
              recovered: { type: 'number', example: 32000.0 },
              outstanding: { type: 'number', example: 13000.0 },
            },
          },
        },
      },

      // ─── INTEGRATION SCHEMAS ───
      LmsLookupResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          source: { type: 'string', example: 'cache' },
          data: {
            type: 'object',
            properties: {
              bl_number: { type: 'string', example: 'PILU1234567' },
              shipper: { type: 'string', example: 'Singapore Agro Exports Pte Ltd' },
              consignee: { type: 'string', example: 'Dubai Food Imports LLC' },
              vessel_name: { type: 'string', example: 'KOTA LAHIR' },
              vessel_voyage: { type: 'string', example: 'V.0142W' },
              discharge_date: { type: 'string', example: '2026-05-01' },
            },
          },
          containers: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                container_number: { type: 'string', example: 'PCIU8912340' },
                size: { type: 'string', example: '20ft' },
                seal_number: { type: 'string', example: 'PIL-99214' },
              },
            },
          },
        },
      },
      ExchangeRatesResult: {
        type: 'object',
        properties: {
          base: { type: 'string', example: 'USD' },
          date: { type: 'string', example: '2026-11-04' },
          rates: {
            type: 'object',
            additionalProperties: { type: 'number' },
            example: {
              USD: 1.0,
              SGD: 1.2812,
              EUR: 0.89453,
              GBP: 0.74567,
              INR: 94.75,
              AED: 3.67,
              CNY: 6.6723,
            },
          },
          source: { type: 'string', example: 'Frankfurter' },
          status: { type: 'string', enum: ['success', 'failed'], example: 'success' },
        },
      },
      Notification: {
        type: 'object',
        properties: {
          id: { type: 'string', example: 'notif-1793084136' },
          type: { type: 'string', example: 'claim' },
          message: { type: 'string', example: 'Claim CLM-2026-0001 has been assigned to claims handler Alfred Tan' },
          claim_id: { type: 'string', nullable: true, example: 'clm-1793084136' },
          user_id: { type: 'string', nullable: true },
          read: { type: 'integer', enum: [0, 1], example: 0 },
          created_date: { type: 'string', format: 'date-time' },
        },
      },
      EmailProviderStatus: {
        type: 'object',
        properties: {
          provider: { type: 'string', enum: ['ms_graph', 'smtp', 'captured_test'], example: 'captured_test' },
          isLive: { type: 'boolean', example: false },
          status: { type: 'string', example: 'Captured Test Outbox (Safe local verification / memory transport)' },
          details: {
            type: 'object',
            properties: {
              tenantIdConfigured: { type: 'boolean', example: false },
              clientIdConfigured: { type: 'boolean', example: false },
              clientSecretConfigured: { type: 'boolean', example: false },
              senderEmailConfigured: { type: 'boolean', example: false },
              smtpHostConfigured: { type: 'boolean', example: true },
            },
          },
        },
      },
      AuditLogEntry: {
        type: 'object',
        properties: {
          id: { type: 'string', example: 'aud-1793084136' },
          entity_type: { type: 'string', example: 'claim' },
          entity_id: { type: 'string', example: 'clm-1793084136' },
          entity_number: { type: 'string', example: 'CLM-2026-0001' },
          action: { type: 'string', example: 'UPDATE' },
          performed_by: { type: 'string', example: 'usr-mid-01' },
          performed_by_name: { type: 'string', example: 'Alfred Tan' },
          field_changed: { type: 'string', example: 'status' },
          old_value: { type: 'string', example: 'new_claim' },
          new_value: { type: 'string', example: 'in_progress' },
          details: { type: 'string', example: 'Status updated to in_progress' },
          created_date: { type: 'string', format: 'date-time' },
        },
      },
      ErrorResponse: {
        type: 'object',
        required: ['error'],
        properties: {
          error: { type: 'string', example: 'Access denied: You do not have permission to view this claim' },
          code: { type: 'string', example: 'UNAUTHORIZED_ACCESS' },
        },
      },
    },
  },
};

/**
 * Ensures docs/openapi.json and docs/openapi.yaml exist on disk for external tools & documentation portals
 */
export function writeOpenApiFile(): { jsonPath: string; yamlPath: string } {
  const docsDir = path.resolve(__dirname, '../../docs');
  if (!fs.existsSync(docsDir)) {
    fs.mkdirSync(docsDir, { recursive: true });
  }
  const jsonPath = path.join(docsDir, 'openapi.json');
  fs.writeFileSync(jsonPath, JSON.stringify(openapiSpecification, null, 2), 'utf-8');

  const yamlPath = path.join(docsDir, 'openapi.yaml');
  fs.writeFileSync(yamlPath, YAML.stringify(openapiSpecification), 'utf-8');

  return { jsonPath, yamlPath };
}
