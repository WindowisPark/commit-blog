import Anthropic from '@anthropic-ai/sdk';

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!_client) {
    _client = new Anthropic();
  }
  return _client;
}

export interface ContextGroup {
  id: string;
  label: string;
  commitShas: string[];
}

export async function groupCommitsByContext(
  commitSummaries: { sha: string; message: string; files: string[] }[],
  retries = 2,
): Promise<ContextGroup[]> {
  const client = getClient();

  const summaryText = commitSummaries
    .map((c) => `- ${c.sha.slice(0, 7)}: ${c.message}\n  files: ${c.files.join(', ')}`)
    .join('\n');

  const systemPrompt = `당신은 소프트웨어 개발 커밋을 분석하는 전문가입니다.
주어진 커밋 목록을 포트폴리오 관점에서 의미 있는 주제/맥락별로 그룹핑하세요.

규칙:
- 포트폴리오에 올릴 만한 의미 있는 단위로 묶기
- 너무 작은 그룹(1-2 커밋)은 가까운 맥락의 그룹에 합치기
- 그룹 라벨은 블로그 포스트 제목이 될 수 있는 수준으로 (한국어)
- id는 영문 kebab-case (예: "auth-system", "pdf-parser")

응답 형식 (반드시 이 JSON 형식으로):
{
  "groups": [
    { "id": "feature-name", "label": "기능 설명", "commitShas": ["sha1", "sha2"] }
  ]
}`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2048,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: `다음 커밋들을 맥락별로 그룹핑해 주세요:\n\n${summaryText}`,
          },
        ],
      });

      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('');

      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found in response');

      const parsed = JSON.parse(jsonMatch[0]) as { groups: ContextGroup[] };

      console.log(
        `  [Claude Grouping] Tokens: input=${response.usage.input_tokens}, output=${response.usage.output_tokens}`,
      );

      return parsed.groups;
    } catch (err) {
      if (attempt === retries) throw err;
      console.warn(`  [Claude Grouping] Retry ${attempt + 1}/${retries}:`, (err as Error).message);
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }

  throw new Error('Unreachable');
}

export interface GeneratedPost {
  title: string;
  description: string;
  content: string;
}

export async function generateBlogPost(
  repoDisplayName: string,
  commitData: string,
  retries = 2,
): Promise<GeneratedPost> {
  const client = getClient();

  const systemPrompt = `당신은 소프트웨어 개발 블로그 작성 전문가입니다.
커밋 기록과 코드 변경사항을 분석하여 읽기 좋은 한국어 기술 블로그 포스트를 작성합니다.

규칙:
- 800~1200 단어로 작성 (짧고 임팩트 있게)
- 개발자가 읽기 좋은 자연스러운 한국어 사용
- h2 소제목으로 글의 구조를 잡기 (3~5개)
- h3는 꼭 필요한 경우에만, 최소화
- **볼드**는 핵심 기술명이나 결정 포인트에만 사용 (문단당 1~2개)
- 코드블록은 가장 인상적이고 핵심적인 것만 3개 이하
- 기울임(*italic*), blockquote(>) 사용하지 않기
- 리스트는 3개 이상 나열할 때만, 그 외에는 문장으로 서술
- 포트폴리오 독자를 위해: "무엇을 왜 만들었고, 어떤 기술적 도전이 있었는지" 중심
- 커밋 메시지를 그대로 나열하지 말고, 맥락과 의미를 설명

응답 형식 (반드시 이 JSON 형식으로):
{
  "title": "포스트 제목 (간결하고 흥미로운)",
  "description": "1-2문장 요약",
  "content": "마크다운 본문 (프론트매터 제외)"
}`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: `다음은 "${repoDisplayName}" 프로젝트의 최근 커밋 기록입니다. 이를 바탕으로 블로그 포스트를 작성해 주세요.\n\n${commitData}`,
          },
        ],
      });

      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('');

      // Extract JSON from response (handle markdown code blocks)
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found in response');

      const parsed = JSON.parse(jsonMatch[0]) as GeneratedPost;

      console.log(
        `  [Claude] Tokens: input=${response.usage.input_tokens}, output=${response.usage.output_tokens}`,
      );

      return parsed;
    } catch (err) {
      if (attempt === retries) throw err;
      console.warn(`  [Claude] Retry ${attempt + 1}/${retries}:`, (err as Error).message);
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }

  throw new Error('Unreachable');
}
