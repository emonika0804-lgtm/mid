import nodemailer from 'nodemailer';
import crypto from 'crypto';
import db from './db';

export interface EmailAttachment {
  filename: string;
  content?: Buffer | string;
  path?: string;
  contentType?: string;
}

export interface SendEmailOptions {
  to: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  subject: string;
  text?: string;
  html: string;
  attachments?: EmailAttachment[];
  templateType: 'OTP' | 'PASSWORD_RESET' | 'CLAIM_COMMUNICATION' | 'SURVEY_COMMUNICATION' | 'NOTIFICATION';
  referenceId?: string;
  referenceType?: 'claim' | 'survey' | 'user' | 'system';
}

export interface EmailDeliveryResult {
  success: boolean;
  messageId: string;
  provider: 'ms_graph' | 'smtp' | 'captured_test';
  status: 'delivered' | 'captured_test' | 'blocked_no_credentials' | 'failed';
  error?: string;
}

export interface CapturedEmail {
  id: string;
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  templateType: string;
  timestamp: string;
  attachmentsCount: number;
}

// In-memory captured outbox for automated testing and safe local verification
const capturedOutbox: CapturedEmail[] = [];

/**
 * Acquire Microsoft Graph OAuth 2.0 Access Token via Client Credentials Grant
 */
async function getMsGraphAccessToken(): Promise<string> {
  const tenantId = process.env.MS_GRAPH_TENANT_ID;
  const clientId = process.env.MS_GRAPH_CLIENT_ID;
  const clientSecret = process.env.MS_GRAPH_CLIENT_SECRET;

  if (!tenantId || !clientId || !clientSecret) {
    throw new Error('MS_GRAPH credentials (MS_GRAPH_TENANT_ID, MS_GRAPH_CLIENT_ID, MS_GRAPH_CLIENT_SECRET) are not configured.');
  }

  const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Microsoft Graph token acquisition failed (${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as { access_token: string };
  return data.access_token;
}

/**
 * Send email via Microsoft Graph API
 */
async function sendViaMsGraph(accessToken: string, options: SendEmailOptions): Promise<string> {
  const senderEmail = process.env.MS_GRAPH_SENDER_EMAIL || 'claims-notifications@pilship.com';
  const sendMailUrl = `https://graph.microsoft.com/v1.0/users/${senderEmail}/sendMail`;

  const recipients = Array.isArray(options.to) ? options.to : [options.to];
  const toRecipients = recipients.map((email) => ({
    emailAddress: { address: email.trim() },
  }));

  const messagePayload: any = {
    message: {
      subject: options.subject,
      body: {
        contentType: 'HTML',
        content: options.html,
      },
      toRecipients,
    },
    saveToSentItems: 'true',
  };

  if (options.attachments && options.attachments.length > 0) {
    messagePayload.message.attachments = options.attachments.map((att) => {
      let contentBase64 = '';
      if (Buffer.isBuffer(att.content)) {
        contentBase64 = att.content.toString('base64');
      } else if (typeof att.content === 'string') {
        contentBase64 = Buffer.from(att.content).toString('base64');
      }
      return {
        '@odata.type': '#microsoft.graph.fileAttachment',
        name: att.filename,
        contentType: att.contentType || 'application/octet-stream',
        contentBytes: contentBase64,
      };
    });
  }

  const response = await fetch(sendMailUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(messagePayload),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Microsoft Graph sendMail failed (${response.status}): ${errText}`);
  }

  return `msg-graph-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

/**
 * Send email via standard SMTP Transport (Nodemailer)
 */
async function sendViaSmtp(options: SendEmailOptions): Promise<string> {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || 'claims@pilship.com';

  if (!host || !user || !pass) {
    throw new Error('SMTP credentials (SMTP_HOST, SMTP_USER, SMTP_PASS) are not configured.');
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: process.env.SMTP_SECURE === 'true' || port === 465,
    auth: { user, pass },
  });

  const mailOptions: any = {
    from,
    to: options.to,
    cc: options.cc,
    bcc: options.bcc,
    subject: options.subject,
    text: options.text,
    html: options.html,
  };

  if (options.attachments && options.attachments.length > 0) {
    mailOptions.attachments = options.attachments.map((att) => ({
      filename: att.filename,
      content: att.content,
      path: att.path,
      contentType: att.contentType,
    }));
  }

  const info = await transporter.sendMail(mailOptions);
  return info.messageId || `msg-smtp-${Date.now()}`;
}

/**
 * Primary Send Email Function
 */
export async function sendEmail(options: SendEmailOptions): Promise<EmailDeliveryResult> {
  const messageId = `msg-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const recipientStr = Array.isArray(options.to) ? options.to.join(', ') : options.to;
  const attachmentsCount = options.attachments ? options.attachments.length : 0;

  // Determine provider configuration
  const configuredProvider = (process.env.EMAIL_PROVIDER || 'captured_test').toLowerCase();
  const forceTestMode = process.env.NODE_ENV === 'test' || process.env.EMAIL_TRANSPORT === 'captured';

  // 1. Safe Captured Test Outbox (for testing / dev verification without sending real emails)
  if (forceTestMode || configuredProvider === 'captured_test') {
    const captured: CapturedEmail = {
      id: messageId,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
      templateType: options.templateType,
      timestamp: new Date().toISOString(),
      attachmentsCount,
    };
    capturedOutbox.push(captured);

    // Keep memory outbox bounded to last 200 messages
    if (capturedOutbox.length > 200) {
      capturedOutbox.shift();
    }

    // Record in database email_logs
    try {
      await db.prepare(`
        INSERT INTO email_logs (
          id, recipient, subject, template_type, delivery_status,
          provider, error_message, reference_id, reference_type, attachments_count, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
      `).run(
        messageId,
        recipientStr,
        options.subject,
        options.templateType,
        'captured_test',
        'captured_test',
        null,
        options.referenceId || null,
        options.referenceType || null,
        attachmentsCount
      );
    } catch (e: any) {
      console.warn('[EmailService] Failed to write email_logs entry:', e?.message || e);
    }

    return {
      success: true,
      messageId,
      provider: 'captured_test',
      status: 'captured_test',
    };
  }

  // 2. Microsoft Graph Integration Flow
  if (configuredProvider === 'ms_graph') {
    const hasCredentials = Boolean(
      process.env.MS_GRAPH_TENANT_ID &&
      process.env.MS_GRAPH_CLIENT_ID &&
      process.env.MS_GRAPH_CLIENT_SECRET
    );

    if (!hasCredentials) {
      const errorMsg = 'BLOCKED: Missing Microsoft Graph credentials (MS_GRAPH_TENANT_ID, MS_GRAPH_CLIENT_ID, MS_GRAPH_CLIENT_SECRET) in .env';
      console.warn(`[EmailService] ${errorMsg}`);

      // Capture locally so test and development flows remain functional without falsely reporting live delivery
      capturedOutbox.push({
        id: messageId,
        to: options.to,
        subject: options.subject,
        html: options.html,
        text: options.text,
        templateType: options.templateType,
        timestamp: new Date().toISOString(),
        attachmentsCount,
      });

      try {
        await db.prepare(`
          INSERT INTO email_logs (
            id, recipient, subject, template_type, delivery_status,
            provider, error_message, reference_id, reference_type, attachments_count, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
        `).run(
          messageId,
          recipientStr,
          options.subject,
          options.templateType,
          'blocked_no_credentials',
          'ms_graph',
          errorMsg,
          options.referenceId || null,
          options.referenceType || null,
          attachmentsCount
        );
      } catch (e: any) {
        console.warn('[EmailService] Failed to record email log:', e);
      }

      return {
        success: false,
        messageId,
        provider: 'ms_graph',
        status: 'blocked_no_credentials',
        error: errorMsg,
      };
    }

    try {
      const accessToken = await getMsGraphAccessToken();
      const graphMessageId = await sendViaMsGraph(accessToken, options);

      await db.prepare(`
        INSERT INTO email_logs (
          id, recipient, subject, template_type, delivery_status,
          provider, error_message, reference_id, reference_type, attachments_count, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
      `).run(
        graphMessageId,
        recipientStr,
        options.subject,
        options.templateType,
        'delivered',
        'ms_graph',
        null,
        options.referenceId || null,
        options.referenceType || null,
        attachmentsCount
      );

      return {
        success: true,
        messageId: graphMessageId,
        provider: 'ms_graph',
        status: 'delivered',
      };
    } catch (err: any) {
      console.error('[EmailService] Microsoft Graph send error:', err?.message || err);
      await db.prepare(`
        INSERT INTO email_logs (
          id, recipient, subject, template_type, delivery_status,
          provider, error_message, reference_id, reference_type, attachments_count, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
      `).run(
        messageId,
        recipientStr,
        options.subject,
        options.templateType,
        'failed',
        'ms_graph',
        err?.message || String(err),
        options.referenceId || null,
        options.referenceType || null,
        attachmentsCount
      );

      return {
        success: false,
        messageId,
        provider: 'ms_graph',
        status: 'failed',
        error: err?.message || String(err),
      };
    }
  }

  // 3. SMTP Integration Flow
  if (configuredProvider === 'smtp') {
    const hasSmtp = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
    if (!hasSmtp) {
      const errorMsg = 'BLOCKED: Missing SMTP credentials (SMTP_HOST, SMTP_USER, SMTP_PASS) in .env';
      return {
        success: false,
        messageId,
        provider: 'smtp',
        status: 'blocked_no_credentials',
        error: errorMsg,
      };
    }

    try {
      const smtpMessageId = await sendViaSmtp(options);
      await db.prepare(`
        INSERT INTO email_logs (
          id, recipient, subject, template_type, delivery_status,
          provider, error_message, reference_id, reference_type, attachments_count, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
      `).run(
        smtpMessageId,
        recipientStr,
        options.subject,
        options.templateType,
        'delivered',
        'smtp',
        null,
        options.referenceId || null,
        options.referenceType || null,
        attachmentsCount
      );

      return {
        success: true,
        messageId: smtpMessageId,
        provider: 'smtp',
        status: 'delivered',
      };
    } catch (err: any) {
      return {
        success: false,
        messageId,
        provider: 'smtp',
        status: 'failed',
        error: err?.message || String(err),
      };
    }
  }

  return {
    success: false,
    messageId,
    provider: 'captured_test',
    status: 'failed',
    error: `Unknown email provider: ${configuredProvider}`,
  };
}

/**
 * Send OTP Verification Email
 */
export async function sendOtpEmail(params: {
  to: string;
  fullName: string;
  otp: string;
  expiresInMinutes?: number;
}): Promise<EmailDeliveryResult> {
  const expiresIn = params.expiresInMinutes || 10;

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px; color: #1e293b; }
        .container { max-width: 560px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; }
        .header { background: #002B49; padding: 24px 32px; display: flex; align-items: center; border-bottom: 3px solid #ED1C24; }
        .logo { background: #ED1C24; color: white; font-weight: 900; font-size: 20px; padding: 6px 14px; border-radius: 6px; letter-spacing: 1px; display: inline-block; }
        .brand-text { color: #ffffff; font-size: 14px; margin-left: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
        .content { padding: 32px; }
        .otp-box { background: #f1f5f9; border: 2px dashed #0284c7; border-radius: 8px; padding: 18px; text-align: center; margin: 24px 0; font-family: monospace; font-size: 32px; font-weight: 800; letter-spacing: 10px; color: #0f172a; }
        .footer { background: #f8fafc; padding: 20px 32px; font-size: 11px; color: #64748b; border-top: 1px solid #e2e8f0; text-align: center; }
        .warning { font-size: 12px; color: #b91c1c; background: #fef2f2; border: 1px solid #fee2e2; padding: 10px 14px; border-radius: 6px; margin-top: 16px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <span class="logo">PIL</span>
          <span class="brand-text">Pacific International Lines</span>
        </div>
        <div class="content">
          <h2 style="margin-top: 0; font-size: 20px; color: #0f172a;">Account Verification Code</h2>
          <p>Hello <strong>${escapeHtml(params.fullName)}</strong>,</p>
          <p>Please use the following 6-digit verification code to complete your registration on the PIL Cargo Claim & Survey Management Platform:</p>
          
          <div class="otp-box">${params.otp}</div>
          
          <p style="font-size: 13px; color: #475569;">
            This code is strictly valid for <strong>${expiresIn} minutes</strong> and allows a maximum of 5 verification attempts.
          </p>
          
          <div class="warning">
            <strong>Security Notice:</strong> PIL personnel will never ask for your verification code. Never share this code with anyone.
          </div>
        </div>
        <div class="footer">
          Pacific International Lines (Pte) Ltd &bull; 140 Cecil Street, PIL Building, Singapore 069540<br/>
          Confidential and Proprietary &bull; Internal Maritime Logistics Operations
        </div>
      </div>
    </body>
    </html>
  `;

  return sendEmail({
    to: params.to,
    subject: `[PIL Claims] Your Verification Code: ${params.otp.substring(0, 3)}...`,
    text: `Hello ${params.fullName},\n\nYour PIL verification code is: ${params.otp}\n\nThis code expires in ${expiresIn} minutes. Do not share it with anyone.`,
    html,
    templateType: 'OTP',
    referenceType: 'user',
  });
}

/**
 * Send Password Reset Email
 */
export async function sendPasswordResetEmail(params: {
  to: string;
  fullName: string;
  resetUrl: string;
  expiresInHours?: number;
}): Promise<EmailDeliveryResult> {
  const expiresIn = params.expiresInHours || 1;

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px; color: #1e293b; }
        .container { max-width: 560px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; }
        .header { background: #002B49; padding: 24px 32px; display: flex; align-items: center; border-bottom: 3px solid #ED1C24; }
        .logo { background: #ED1C24; color: white; font-weight: 900; font-size: 20px; padding: 6px 14px; border-radius: 6px; letter-spacing: 1px; display: inline-block; }
        .brand-text { color: #ffffff; font-size: 14px; margin-left: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
        .content { padding: 32px; }
        .cta-btn { display: inline-block; background: #0284c7; color: #ffffff !important; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-weight: 600; font-size: 14px; margin: 20px 0; }
        .footer { background: #f8fafc; padding: 20px 32px; font-size: 11px; color: #64748b; border-top: 1px solid #e2e8f0; text-align: center; }
        .subtext { font-size: 12px; color: #64748b; line-height: 1.5; margin-top: 16px; word-break: break-all; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <span class="logo">PIL</span>
          <span class="brand-text">Pacific International Lines</span>
        </div>
        <div class="content">
          <h2 style="margin-top: 0; font-size: 20px; color: #0f172a;">Password Reset Request</h2>
          <p>Hello <strong>${escapeHtml(params.fullName)}</strong>,</p>
          <p>We received a request to reset your password for your PIL Cargo Claim & Survey Platform account. Click the button below to proceed:</p>
          
          <div style="text-align: center;">
            <a href="${params.resetUrl}" class="cta-btn" target="_blank">Reset My Password</a>
          </div>
          
          <p class="subtext">
            This password reset link is strictly valid for <strong>${expiresIn} hour</strong> and can only be used once. If you did not request this, please disregard this email or notify security immediately.
          </p>
          <p class="subtext">
            Direct Link: <a href="${params.resetUrl}">${params.resetUrl}</a>
          </p>
        </div>
        <div class="footer">
          Pacific International Lines (Pte) Ltd &bull; 140 Cecil Street, PIL Building, Singapore 069540<br/>
          Confidential and Proprietary &bull; Internal Maritime Logistics Operations
        </div>
      </div>
    </body>
    </html>
  `;

  return sendEmail({
    to: params.to,
    subject: '[PIL Claims] Password Reset Request',
    text: `Hello ${params.fullName},\n\nClick the link below to reset your password:\n${params.resetUrl}\n\nThis link expires in ${expiresIn} hour.`,
    html,
    templateType: 'PASSWORD_RESET',
    referenceType: 'user',
  });
}

/**
 * Send Claim or Survey Communication Email
 */
export async function sendEntityCommunicationEmail(params: {
  to: string;
  from?: string;
  subject: string;
  body: string;
  referenceId: string;
  referenceType: 'claim' | 'survey';
  referenceNumber: string;
  blNumber?: string;
  attachments?: EmailAttachment[];
}): Promise<EmailDeliveryResult> {
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px; color: #1e293b; }
        .container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; }
        .header { background: #002B49; padding: 20px 28px; display: flex; align-items: center; border-bottom: 3px solid #ED1C24; }
        .logo { background: #ED1C24; color: white; font-weight: 900; font-size: 18px; padding: 4px 10px; border-radius: 4px; display: inline-block; }
        .brand-text { color: #ffffff; font-size: 13px; margin-left: 10px; font-weight: 600; text-transform: uppercase; }
        .meta-bar { background: #f1f5f9; padding: 12px 28px; font-size: 12px; color: #475569; border-bottom: 1px solid #e2e8f0; }
        .content { padding: 28px; font-size: 14px; line-height: 1.6; white-space: pre-wrap; }
        .footer { background: #f8fafc; padding: 16px 28px; font-size: 11px; color: #64748b; border-top: 1px solid #e2e8f0; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <span class="logo">PIL</span>
          <span class="brand-text">Pacific International Lines &bull; Claims & Survey</span>
        </div>
        <div class="meta-bar">
          <strong>Ref:</strong> ${escapeHtml(params.referenceNumber)} &bull; 
          <strong>BL:</strong> ${escapeHtml(params.blNumber || 'N/A')}
        </div>
        <div class="content">
${escapeHtml(params.body)}
        </div>
        <div class="footer">
          This message was dispatched through the PIL Cargo Claim & Survey Management Platform.<br/>
          Pacific International Lines &bull; Singapore
        </div>
      </div>
    </body>
    </html>
  `;

  return sendEmail({
    to: params.to,
    subject: params.subject,
    text: params.body,
    html,
    attachments: params.attachments,
    templateType: params.referenceType === 'claim' ? 'CLAIM_COMMUNICATION' : 'SURVEY_COMMUNICATION',
    referenceId: params.referenceId,
    referenceType: params.referenceType,
  });
}

/**
 * Check Provider Configuration & Status
 */
export function getEmailProviderStatus(): {
  provider: 'ms_graph' | 'smtp' | 'captured_test';
  isLive: boolean;
  status: string;
  details: {
    tenantIdConfigured: boolean;
    clientIdConfigured: boolean;
    clientSecretConfigured: boolean;
    senderEmailConfigured: boolean;
    smtpHostConfigured: boolean;
  };
} {
  const configuredProvider = (process.env.EMAIL_PROVIDER || 'captured_test').toLowerCase() as any;
  const isTestMode = process.env.NODE_ENV === 'test' || process.env.EMAIL_TRANSPORT === 'captured';

  const tenantIdConfigured = Boolean(process.env.MS_GRAPH_TENANT_ID);
  const clientIdConfigured = Boolean(process.env.MS_GRAPH_CLIENT_ID);
  const clientSecretConfigured = Boolean(process.env.MS_GRAPH_CLIENT_SECRET);
  const senderEmailConfigured = Boolean(process.env.MS_GRAPH_SENDER_EMAIL);
  const smtpHostConfigured = Boolean(process.env.SMTP_HOST);

  if (isTestMode || configuredProvider === 'captured_test') {
    return {
      provider: 'captured_test',
      isLive: false,
      status: 'Captured Test Outbox (Safe local verification / memory transport)',
      details: {
        tenantIdConfigured,
        clientIdConfigured,
        clientSecretConfigured,
        senderEmailConfigured,
        smtpHostConfigured,
      },
    };
  }

  if (configuredProvider === 'ms_graph') {
    const isComplete = tenantIdConfigured && clientIdConfigured && clientSecretConfigured;
    return {
      provider: 'ms_graph',
      isLive: isComplete,
      status: isComplete
        ? 'Active (Microsoft 365 Graph OAuth 2.0 Client Credentials)'
        : 'BLOCKED: Missing Microsoft Graph Azure AD tenant/client credentials in environment',
      details: {
        tenantIdConfigured,
        clientIdConfigured,
        clientSecretConfigured,
        senderEmailConfigured,
        smtpHostConfigured,
      },
    };
  }

  if (configuredProvider === 'smtp') {
    const isComplete = smtpHostConfigured && Boolean(process.env.SMTP_USER);
    return {
      provider: 'smtp',
      isLive: isComplete,
      status: isComplete
        ? 'Active (SMTP Transport)'
        : 'BLOCKED: Missing SMTP host/credentials in environment',
      details: {
        tenantIdConfigured,
        clientIdConfigured,
        clientSecretConfigured,
        senderEmailConfigured,
        smtpHostConfigured,
      },
    };
  }

  return {
    provider: 'captured_test',
    isLive: false,
    status: 'Captured Test Mode',
    details: {
      tenantIdConfigured,
      clientIdConfigured,
      clientSecretConfigured,
      senderEmailConfigured,
      smtpHostConfigured,
    },
  };
}

/**
 * Test Utilities: Query and Clear Captured Outbox
 */
export function getCapturedOutbox(): CapturedEmail[] {
  return [...capturedOutbox];
}

export function clearCapturedOutbox(): void {
  capturedOutbox.length = 0;
}

function escapeHtml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
