// GEM² Mesh Gateway — Layer 0 (lobstertrap DPI) + Layer 1 (TPMN API)
// Call gem2Check(text, agentId) before executing any bot-to-bot handle: task.
// Returns { allowed: bool, verdict: string, risk: float, flags: [], layer: 0|1, truthScore? }

import { spawn } from 'child_process';
import { existsSync } from 'fs';

const LOBSTERTRAP = '/root/gem2-hackathon/lobstertrap';
const POLICY = '/root/gem2-hackathon/governance-demo/policies/gem2_enterprise.yaml';
const GEM2_API_URL = process.env.GEM2_API_URL || 'https://gem2-tpmn-checker.fly.dev';
const GEM2_API_KEY = process.env.GEM2_API_KEY || '';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const LLM_MODEL = process.env.LLM_MODEL || 'gemini-2.5-flash';

const FLAG_KEYS = [
  'contains_injection_patterns', 'contains_harm_patterns', 'contains_malware_request',
  'contains_role_impersonation', 'contains_exfiltration', 'contains_phishing_patterns',
  'contains_obfuscation', 'contains_system_commands', 'contains_credentials',
];

// Layer 0: local lobstertrap DPI — no external network
async function layer0(text) {
  if (!existsSync(LOBSTERTRAP)) return { verdict: 'ALLOW', risk: 0, flags: [], layer: 0 };

  return new Promise((resolve) => {
    const proc = spawn(LOBSTERTRAP, ['inspect', '--policy', POLICY, text], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '', stderr = '';
    proc.stdout.on('data', d => { stdout += d; });
    proc.stderr.on('data', d => { stderr += d; });

    const timer = setTimeout(() => { proc.kill(); resolve({ verdict: 'ALLOW', risk: 0, flags: [], layer: 0 }); }, 5000);

    proc.on('close', () => {
      clearTimeout(timer);
      try {
        const jsonStart = stdout.indexOf('{');
        const jsonEnd = stdout.lastIndexOf('}') + 1;
        const meta = jsonStart >= 0 ? JSON.parse(stdout.slice(jsonStart, jsonEnd)) : {};
        const flags = FLAG_KEYS.filter(k => meta[k]).map(k => k.replace('contains_', '').replace(/_/g, ' '));

        let verdict = 'ALLOW';
        // Policy decision may be on stderr or after JSON in stdout
        const policySection = stderr + stdout.slice(jsonEnd);
        for (const line of policySection.split('\n')) {
          const trimmed = line.trim();
          if (trimmed.startsWith('Action:')) { verdict = trimmed.split(':')[1]?.trim() || verdict; break; }
        }

        resolve({ verdict, risk: parseFloat(meta.risk_score ?? 0), flags, layer: 0 });
      } catch {
        resolve({ verdict: 'ALLOW', risk: 0, flags: [], layer: 0 });
      }
    });

    proc.on('error', () => { clearTimeout(timer); resolve({ verdict: 'ALLOW', risk: 0, flags: [], layer: 0 }); });
  });
}

// Layer 1: GEM² TPMN cloud API — requires GEM2_API_KEY + GEMINI_API_KEY
async function layer1(text, agentId) {
  if (!GEM2_API_KEY || !GEMINI_API_KEY) return null;

  try {
    const res = await fetch(`${GEM2_API_URL}/api/v1/truth-filter`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: text,
        session_context: agentId,
        gem2_api_key: GEM2_API_KEY,
        gemini_api_key: GEMINI_API_KEY,
        provider: 'gemini',
        model: LLM_MODEL,
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) return null;
    const data = await res.json();

    const truthScore = parseInt(data.truth_score ?? data.truthscore ?? 0);
    const raw = data.verdict;
    const verdict = (raw === 'ALLOW' || raw === 'REVIEW' || raw === 'BLOCK') ? raw
      : truthScore >= 70 ? 'ALLOW' : truthScore >= 40 ? 'REVIEW' : 'BLOCK';

    const flags = Array.isArray(data.spt_issues)
      ? data.spt_issues.map(i => (typeof i === 'string' ? i : i.type || i.claim || '')).filter(Boolean)
      : [];

    return { verdict, risk: 1 - (truthScore / 100), truthScore, flags, layer: 1 };
  } catch {
    return null;
  }
}

// Main export — run both layers, return gate decision
export async function gem2Check(text, agentId = 'mesh-bot') {
  if (process.env.GEM2_BYPASS === 'true') {
    return { allowed: true, verdict: 'ALLOW', risk: 0, flags: [], layer: -1 };
  }

  const l0 = await layer0(text);

  if (l0.verdict === 'DENY' || l0.verdict === 'BLOCK') {
    console.log(`[gem2] Layer 0 BLOCK risk=${l0.risk} flags=${l0.flags.join(',')}`);
    return { allowed: false, verdict: 'BLOCK', risk: l0.risk, flags: l0.flags, layer: 0 };
  }

  const l1 = await layer1(text, agentId);
  if (l1) {
    const blocked = l1.verdict === 'BLOCK' || l1.verdict === 'DENY';
    console.log(`[gem2] Layer 1 ${l1.verdict} truth=${l1.truthScore} risk=${l1.risk.toFixed(3)} flags=${l1.flags.join(',')}`);
    return { allowed: !blocked, verdict: l1.verdict, risk: l1.risk, truthScore: l1.truthScore, flags: l1.flags, layer: 1 };
  }

  return { allowed: true, verdict: l0.verdict, risk: l0.risk, flags: l0.flags, layer: 0 };
}
