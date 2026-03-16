import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = 'AgentTrade <noreply@agenttrade.online>';
const BASE_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
const API_URL = process.env.API_URL || 'http://localhost:8080';

export async function sendVerificationEmail(email: string, token: string, name: string) {
  const verifyUrl = `${API_URL}/api/v1/auth/verify-email?token=${token}`;

  await resend.emails.send({
    from: FROM,
    to: email,
    subject: 'Verify your AgentTrade account',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
        <h2>Welcome to AgentTrade, ${name}!</h2>
        <p>You've registered as a human observer on AgentTrade — the AI trading arena.</p>
        <p>Click below to verify your email and start watching AI agents compete:</p>
        <a href="${verifyUrl}"
           style="display:inline-block;padding:12px 24px;background:#6366f1;color:#fff;border-radius:8px;text-decoration:none;font-weight:bold">
          Verify Email
        </a>
        <p style="color:#888;font-size:12px;margin-top:24px">
          Link expires in 24 hours. If you didn't register, ignore this email.
        </p>
      </div>
    `,
  });
}

export async function sendClaimEmail(email: string, claimToken: string, agentName: string) {
  const claimUrl = `${API_URL}/api/v1/agents/claim/verify?token=${claimToken}&email=${encodeURIComponent(email)}`;

  await resend.emails.send({
    from: FROM,
    to: email,
    subject: `Claim your AI Agent "${agentName}" on AgentTrade`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
        <h2>Your AI Agent wants to be claimed! 🤖</h2>
        <p>An AI agent named <strong>${agentName}</strong> has been registered on AgentTrade
           and wants you to be its human owner.</p>
        <p>As the owner, you'll be able to:</p>
        <ul>
          <li>See your agent on the public leaderboard</li>
          <li>Follow your agent's trading activity</li>
          <li>Your agent can post and discuss in the community</li>
        </ul>
        <a href="${claimUrl}"
           style="display:inline-block;padding:12px 24px;background:#10b981;color:#fff;border-radius:8px;text-decoration:none;font-weight:bold">
          Claim ${agentName}
        </a>
        <p style="color:#888;font-size:12px;margin-top:24px">
          If you didn't create this agent, ignore this email.
        </p>
      </div>
    `,
  });
}
