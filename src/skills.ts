// Skill dictionary used to match job descriptions against your profile.
// Whether you *have* a skill isn't listed here: it's detected from data/profile.yaml,
// so adding a skill to your profile automatically makes it count as a match.

const SKILLS: Record<string, string[]> = {
  TypeScript: ['typescript'],
  JavaScript: ['javascript', 'es6', 'ecmascript'],
  React: ['react', 'react.js', 'reactjs'],
  'Next.js': ['next.js', 'nextjs'],
  Redux: ['redux', 'redux toolkit'],
  'TanStack Query': ['tanstack query', 'react query'],
  'Tailwind CSS': ['tailwind', 'tailwindcss'],
  Vite: ['vite'],
  'HTML/CSS': ['html', 'css', 'html5', 'css3'],
  Accessibility: ['accessibility', 'a11y', 'aria', 'wcag'],
  'Node.js': ['node', 'node.js', 'nodejs'],
  Express: ['express', 'express.js', 'expressjs'],
  Fastify: ['fastify'],
  NestJS: ['nestjs', 'nest.js'],
  'REST APIs': ['restful', 'rest api', 'rest apis', 'rest-based'],
  GraphQL: ['graphql', 'apollo'],
  'Socket.IO / WebSockets': ['socket.io', 'websocket', 'websockets'],
  MongoDB: ['mongodb', 'mongo', 'mongoose'],
  PostgreSQL: ['postgresql', 'postgres'],
  MySQL: ['mysql'],
  Redis: ['redis'],
  Prisma: ['prisma'],
  'Message queues': ['bullmq', 'rabbitmq', 'kafka', 'sqs', 'message queue', 'message queues'],
  JWT: ['jwt'],
  'OAuth / SSO': ['oauth', 'oauth2', 'oidc', 'openid connect', 'sso', 'single sign-on'],
  Docker: ['docker', 'containerization', 'containerized', 'docker compose'],
  Kubernetes: ['kubernetes', 'k8s', 'eks', 'gke', 'aks', 'kubectl'],
  Helm: ['helm'],
  'Argo CD / GitOps': ['argocd', 'argo cd', 'gitops', 'fluxcd'],
  Terraform: ['terraform', 'opentofu'],
  Ansible: ['ansible'],
  AWS: ['aws', 'amazon web services', 'ec2', 'ecs', 'fargate', 'lambda', 'cloudfront', 'dynamodb'],
  Azure: ['azure'],
  GCP: ['gcp', 'google cloud'],
  'CI/CD': ['ci/cd', 'cicd', 'continuous integration', 'continuous delivery', 'continuous deployment'],
  'GitHub Actions': ['github actions'],
  Jenkins: ['jenkins'],
  'GitLab CI': ['gitlab ci', 'gitlab-ci'],
  Linux: ['linux', 'ubuntu', 'debian', 'unix'],
  Bash: ['bash', 'shell scripting'],
  Nginx: ['nginx', 'reverse proxy'],
  Prometheus: ['prometheus'],
  Grafana: ['grafana', 'loki'],
  Observability: ['observability', 'monitoring', 'alerting'],
  Datadog: ['datadog'],
  Sentry: ['sentry'],
  Serverless: ['serverless'],
  'Security scanning': ['devsecops', 'trivy', 'codeql', 'vulnerability scanning', 'secrets management'],
  Playwright: ['playwright'],
  'Jest / Vitest': ['jest', 'vitest'],
  Testing: ['unit testing', 'unit tests', 'integration tests', 'integration testing', 'e2e', 'end-to-end tests', 'supertest', 'tdd'],
  Git: ['git'],
  Microservices: ['microservices', 'microservice'],
  'LLM / AI APIs': ['llm', 'llms', 'openai', 'rag', 'langchain', 'ollama', 'generative ai'],
  'AI coding tools': ['claude code', 'cursor', 'copilot', 'agentic', 'ai-assisted', 'ai assisted'],
  Python: ['python', 'django', 'flask', 'fastapi'],
  Go: ['golang'],
  Java: ['java', 'spring boot'],
  PHP: ['php', 'laravel'],
  Ruby: ['ruby', 'rails'],
  '.NET / C#': ['.net', 'c#', 'asp.net'],
  Rust: ['rust'],
  'Vue.js': ['vue', 'vue.js', 'nuxt'],
  Angular: ['angular'],
  'React Native': ['react native'],
  Elasticsearch: ['elasticsearch', 'opensearch'],
};

// Skills whose aliases are also everyday English words: only trust them in a technical context.
const CONTEXT: Record<string, RegExp> = {
  Express: /express(\.js|js)\b|node(\.js)?\s*[/,&+]\s*express|express\s*[/,&+]\s*(node|mongo|postgres)/i,
  'Node.js': /node\.?js|\bnode\b\s*[/,&+(]|[/,&+]\s*node\b|\bnode (backend|developer|engineer|api|services?)/i,
  'AI coding tools': /claude code|cursor (ide|ai)|\bcursor\b\s*[/,&+]|copilot|agentic|ai[- ]assisted/i,
};

const compiled = Object.entries(SKILLS).map(([name, aliases]) => {
  const parts = aliases.map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '[\\s-]?'));
  return { name, re: new RegExp(`(?<![a-z0-9#])(?:${parts.join('|')})(?![a-z0-9#+])`, 'i') };
});

export const ALL_SKILLS = Object.keys(SKILLS);

/**
 * @param strict apply the CONTEXT checks; use for job descriptions (free English text),
 *               not for your own profile, which is technical throughout.
 */
export function detectSkills(text: string, strict = true): Set<string> {
  const found = new Set<string>();
  for (const { name, re } of compiled) {
    if (!re.test(text)) continue;
    if (strict && CONTEXT[name] && !CONTEXT[name].test(text)) continue;
    found.add(name);
  }
  return found;
}

/** Same as detectSkills, but counts occurrences so frequently-mentioned skills rank higher. */
export function skillFrequency(text: string): Map<string, number> {
  const freq = new Map<string, number>();
  for (const name of detectSkills(text)) {
    const re = new RegExp(compiled.find((c) => c.name === name)!.re.source, 'gi');
    freq.set(name, text.match(re)?.length ?? 1);
  }
  return freq;
}
